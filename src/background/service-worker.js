const REDIRECT_LOG_KEY = 'redirectLog';
const MAX_RECORDS = 50;
const ACTIVE_CHAIN_TIMEOUT_MS = 5 * 60 * 1000; // Clean up stale chains after 5 minutes.

const TRACKING_KEYWORDS = ['pixel', 'track', 'collect', 'analytics', 'impression', 'beacon', 'measure'];
const PIXEL_EXTENSIONS = ['.gif', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.svg'];

const activeChains = new Map();

function getHeaderValue(headers = [], headerName) {
  if (!Array.isArray(headers) || !headerName) {
    return undefined;
  }

  const target = headerName.toLowerCase();
  const match = headers.find((header) => header?.name?.toLowerCase() === target);
  return match?.value;
}

function parseContentLength(value) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function hasTrackingKeyword(url) {
  if (!url) {
    return false;
  }

  const lowerUrl = url.toLowerCase();
  return TRACKING_KEYWORDS.some((keyword) => lowerUrl.includes(keyword));
}

function hasPixelExtension(url) {
  if (!url) {
    return false;
  }

  const lowerUrl = url.toLowerCase();
  return PIXEL_EXTENSIONS.some((extension) => lowerUrl.endsWith(extension));
}

function classifyRecord(record, completionDetails = {}) {
  const heuristics = [];
  const events = Array.isArray(record.events) ? record.events : [];
  const finalUrl = record.finalUrl || '';

  if (events.length <= 1) {
    heuristics.push('single hop chain');
  }

  if (events.length > 0 && events.every((event) => event.type === 'image')) {
    heuristics.push('all hops are image requests');
  }

  if (hasPixelExtension(finalUrl)) {
    heuristics.push('image file extension');
  }

  if (hasTrackingKeyword(finalUrl)) {
    heuristics.push('tracking keyword in URL');
  }

  if (completionDetails.type === 'image') {
    heuristics.push('final resource is an image');
  }

  const contentType = getHeaderValue(completionDetails.responseHeaders, 'content-type');
  if (typeof contentType === 'string' && contentType.toLowerCase().includes('image/')) {
    heuristics.push('image content-type');
  }

  const contentLength = parseContentLength(getHeaderValue(completionDetails.responseHeaders, 'content-length'));
  if (typeof contentLength === 'number' && contentLength <= 2048) {
    heuristics.push('tiny response size');
  }

  const classification = heuristics.length >= 2 ? 'likely-tracking' : 'normal';

  return {
    classification,
    classificationReason: classification === 'likely-tracking' ? heuristics.join('; ') : undefined,
    contentType: contentType || undefined,
    contentLength
  };
}

function formatTimestamp(timestampMs) {
  if (typeof timestampMs === 'number') {
    return new Date(timestampMs).toISOString();
  }

  return new Date().toISOString();
}

async function appendRedirectRecord(record) {
  try {
    const { [REDIRECT_LOG_KEY]: existing = [] } = await chrome.storage.local.get(REDIRECT_LOG_KEY);
    const updated = [record, ...existing].slice(0, MAX_RECORDS);
    await chrome.storage.local.set({ [REDIRECT_LOG_KEY]: updated });
  } catch (error) {
    console.error('Failed to append redirect record', error);
  }
}

function startCleanupTimer(requestId) {
  const existing = activeChains.get(requestId);
  if (!existing) {
    return;
  }

  if (existing.cleanupTimer) {
    clearTimeout(existing.cleanupTimer);
  }

  existing.cleanupTimer = setTimeout(() => {
    activeChains.delete(requestId);
  }, ACTIVE_CHAIN_TIMEOUT_MS);
}

function getOrCreateChain(details) {
  const existing = activeChains.get(details.requestId);
  if (existing) {
    startCleanupTimer(details.requestId);
    if (typeof details.tabId === 'number' && details.tabId >= 0) {
      existing.tabId = details.tabId;
    }
    if (!existing.initiator && details.initiator) {
      existing.initiator = details.initiator;
    }
    return existing;
  }

  const chain = {
    id: crypto.randomUUID(),
    requestId: details.requestId,
    tabId: details.tabId,
    initiator: details.initiator,
    initiatedAt: formatTimestamp(details.timeStamp),
    events: [],
    cleanupTimer: null
  };

  activeChains.set(details.requestId, chain);
  startCleanupTimer(details.requestId);

  return chain;
}

function recordRedirectEvent(details) {
  const chain = getOrCreateChain(details);

  if (!chain.initialUrl) {
    chain.initialUrl = details.url;
  }

  chain.events.push({
    timestamp: formatTimestamp(details.timeStamp),
    from: details.url,
    to: details.redirectUrl,
    statusCode: details.statusCode,
    method: details.method,
    ip: details.ip,
    type: details.type
  });
}

async function finalizeChain(details, errorMessage) {
  const chain = activeChains.get(details.requestId);

  if (!chain || chain.events.length === 0) {
    if (chain) {
      clearTimeout(chain.cleanupTimer);
      activeChains.delete(details.requestId);
    }
    return;
  }

  clearTimeout(chain.cleanupTimer);

  const completedAt = formatTimestamp(details.timeStamp);
  const record = {
    id: chain.id,
    requestId: chain.requestId,
    tabId: chain.tabId,
    initiator: chain.initiator,
    initiatedAt: chain.initiatedAt,
    completedAt,
    initialUrl: chain.initialUrl || chain.events[0]?.from,
    finalUrl: details.url || chain.events.at(-1)?.to,
    finalStatus: details.statusCode,
    error: errorMessage || null,
    events: chain.events
  };

  activeChains.delete(details.requestId);

  const classification = classifyRecord(record, details);
  record.classification = classification.classification;
  if (classification.classificationReason) {
    record.classificationReason = classification.classificationReason;
  }
  if (classification.contentType) {
    record.contentType = classification.contentType;
  }
  if (typeof classification.contentLength === 'number') {
    record.contentLength = classification.contentLength;
  }

  await appendRedirectRecord(record);
}

chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    recordRedirectEvent(details);
  },
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onCompleted.addListener(
  async (details) => {
    await finalizeChain(details);
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders', 'extraHeaders']
);

chrome.webRequest.onErrorOccurred.addListener(
  async (details) => {
    await finalizeChain(details, details.error);
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders', 'extraHeaders']
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'redirect-inspector:get-log') {
    chrome.storage.local
      .get({ [REDIRECT_LOG_KEY]: [] })
      .then((result) => sendResponse({ log: result[REDIRECT_LOG_KEY] }))
      .catch((error) => {
        console.error('Failed to read redirect log', error);
        sendResponse({ log: [], error: error?.message || 'Unknown error' });
      });
    return true;
  }

  if (message?.type === 'redirect-inspector:clear-log') {
    chrome.storage.local
      .set({ [REDIRECT_LOG_KEY]: [] })
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        console.error('Failed to clear redirect log', error);
        sendResponse({ success: false, error: error?.message || 'Unknown error' });
      });
    return true;
  }

  return undefined;
});
