// src/background/service-worker.js

const REDIRECT_LOG_KEY = 'redirectLog';
const MAX_RECORDS = 50;
const ACTIVE_CHAIN_TIMEOUT_MS = 5 * 60 * 1000; // Clean up stale chains after 5 minutes.
const CLIENT_REDIRECT_GRACE_PERIOD_MS = 1500;

const TRACKING_KEYWORDS = ['pixel', 'track', 'collect', 'analytics', 'impression', 'beacon', 'measure'];
const PIXEL_EXTENSIONS = ['.gif', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.svg'];

const chainsById = new Map();
const requestToChain = new Map();
const tabChains = new Map();
const tabLastCommittedUrl = new Map();
const pendingClientRedirects = new Map();

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

function createChain(details) {
  const chain = {
    id: crypto.randomUUID(),
    requestIds: new Set(),
    tabId: details.tabId,
    initiator: details.initiator,
    initiatedAt: formatTimestamp(details.timeStamp),
    events: [],
    initialUrl: undefined,
    pendingFinalDetails: null,
    finalizeTimer: null,
    awaitingClientRedirect: false,
    awaitingClientRedirectTimer: null,
    cleanupTimer: null
  };

  chainsById.set(chain.id, chain);
  return chain;
}

function getChainByRequestId(requestId) {
  const chainId = requestToChain.get(requestId);
  if (!chainId) {
    return undefined;
  }
  return chainsById.get(chainId);
}

function cancelAwaitingClientRedirect(chain) {
  if (!chain?.awaitingClientRedirect) {
    return;
  }

  chain.awaitingClientRedirect = false;
  if (chain.awaitingClientRedirectTimer) {
    clearTimeout(chain.awaitingClientRedirectTimer);
    chain.awaitingClientRedirectTimer = null;
  }
}

function startCleanupTimer(chain) {
  if (!chain) {
    return;
  }

  if (chain.cleanupTimer) {
    clearTimeout(chain.cleanupTimer);
  }

  chain.cleanupTimer = setTimeout(() => {
    cleanupChain(chain);
  }, ACTIVE_CHAIN_TIMEOUT_MS);
}

function cleanupChain(chain) {
  if (!chain) {
    return;
  }

  if (chain.finalizeTimer) {
    clearTimeout(chain.finalizeTimer);
    chain.finalizeTimer = null;
  }

  if (chain.awaitingClientRedirectTimer) {
    clearTimeout(chain.awaitingClientRedirectTimer);
    chain.awaitingClientRedirectTimer = null;
  }

  if (chain.cleanupTimer) {
    clearTimeout(chain.cleanupTimer);
    chain.cleanupTimer = null;
  }

  for (const requestId of chain.requestIds) {
    requestToChain.delete(requestId);
  }

  if (typeof chain.tabId === 'number' && chain.tabId >= 0) {
    const current = tabChains.get(chain.tabId);
    if (current === chain.id) {
      tabChains.delete(chain.tabId);
    }

    const pending = pendingClientRedirects.get(chain.tabId);
    if (pending?.chainId === chain.id) {
      pendingClientRedirects.delete(chain.tabId);
    }
  }

  chainsById.delete(chain.id);
}

function scheduleChainFinalization(chain) {
  if (!chain || chain.awaitingClientRedirect) {
    return;
  }

  if (chain.finalizeTimer) {
    clearTimeout(chain.finalizeTimer);
  }

  chain.finalizeTimer = setTimeout(() => {
    finalizeChainRecord(chain.id).catch((error) => {
      console.error('Failed to persist redirect chain', error);
    });
  }, CLIENT_REDIRECT_GRACE_PERIOD_MS);
}

async function finalizeChainRecord(chainId) {
  const chain = chainsById.get(chainId);
  if (!chain) {
    return;
  }

  const completion = chain.pendingFinalDetails;
  if (!completion) {
    cleanupChain(chain);
    return;
  }

  const { details, errorMessage } = completion;
  const completedAt = formatTimestamp(details.timeStamp);
  const record = {
    id: chain.id,
    requestId: details.requestId,
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

  chain.pendingFinalDetails = null;

  await appendRedirectRecord(record);
  cleanupChain(chain);
}

function attachRequestToChain(chain, details) {
  if (!chain || !details) {
    return chain;
  }

  if (!chain.requestIds.has(details.requestId)) {
    chain.requestIds.add(details.requestId);
  }
  requestToChain.set(details.requestId, chain.id);

  if (typeof details.tabId === 'number' && details.tabId >= 0) {
    chain.tabId = details.tabId;
    tabChains.set(details.tabId, chain.id);
  }

  if (!chain.initiator && details.initiator) {
    chain.initiator = details.initiator;
  }

  if (chain.awaitingClientRedirect) {
    chain.pendingFinalDetails = null;
  }
  cancelAwaitingClientRedirect(chain);
  startCleanupTimer(chain);

  return chain;
}

function recordRedirectEvent(details) {
  let chain = getChainByRequestId(details.requestId);
  if (!chain) {
    chain = createChain(details);
  }

  attachRequestToChain(chain, details);

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
  const chain = getChainByRequestId(details.requestId);

  if (!chain || chain.events.length === 0) {
    if (chain) {
      cleanupChain(chain);
    }
    return;
  }

  startCleanupTimer(chain);

  chain.pendingFinalDetails = {
    details,
    errorMessage: errorMessage || null
  };

  scheduleChainFinalization(chain);
}

// ---- LISTENERS ----

// связать новый запрос с ожидаемым JS-редиректом
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.type !== 'main_frame' && details.type !== 'sub_frame') {
      return;
    }

    const pending = pendingClientRedirects.get(details.tabId);
    if (!pending) {
      return;
    }

    const chain = chainsById.get(pending.chainId);
    if (!chain) {
      pendingClientRedirects.delete(details.tabId);
      return;
    }

    attachRequestToChain(chain, details);
    if (!chain.initialUrl) {
      chain.initialUrl = details.url;
    }

    pendingClientRedirects.delete(details.tabId);
  },
  { urls: ['<all_urls>'] }
);

// HTTP-редиректы
chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    if (details.type !== 'main_frame' && details.type !== 'sub_frame') {
      return;
    }
    recordRedirectEvent(details);
  },
  { urls: ['<all_urls>'] }
);

// запрос успешно завершился
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    if (details.type !== 'main_frame' && details.type !== 'sub_frame') {
      return;
    }
    await finalizeChain(details);
  },
  { urls: ['<all_urls>'] },
  // ВАЖНО: в MV3 нельзя передавать и responseHeaders, и extraHeaders.
  // Нам нужны заголовки → оставляем только extraHeaders.
  ['extraHeaders']
);

// запрос завершился ошибкой
chrome.webRequest.onErrorOccurred.addListener(
  async (details) => {
    if (details.type !== 'main_frame' && details.type !== 'sub_frame') {
      return;
    }
    await finalizeChain(details, details.error);
  },
  { urls: ['<all_urls>'] },
  ['extraHeaders']
);

// ---- CLIENT-SIDE (JS) REDIRECT TRACKING ----
if (chrome.webNavigation && typeof chrome.webNavigation.onCommitted === 'object' && typeof chrome.webNavigation.onCommitted.addListener === 'function') {
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (typeof details.tabId !== 'number' || details.tabId < 0) {
      return;
    }

    const lastUrl = tabLastCommittedUrl.get(details.tabId);
    tabLastCommittedUrl.set(details.tabId, details.url);

    const chainId = tabChains.get(details.tabId);
    if (!chainId) {
      return;
    }

    const chain = chainsById.get(chainId);
    if (!chain) {
      tabChains.delete(details.tabId);
      return;
    }

    // интересует только переход, помеченный как client_redirect
    if (!Array.isArray(details.transitionQualifiers) || !details.transitionQualifiers.includes('client_redirect')) {
      return;
    }

    // Переход был из JS → ждём новый запрос
    if (chain.finalizeTimer) {
      clearTimeout(chain.finalizeTimer);
      chain.finalizeTimer = null;
    }

    chain.awaitingClientRedirect = true;
    if (chain.awaitingClientRedirectTimer) {
      clearTimeout(chain.awaitingClientRedirectTimer);
    }
    chain.awaitingClientRedirectTimer = setTimeout(() => {
      const stillWaitingChain = chainsById.get(chainId);
      if (!stillWaitingChain) {
        return;
      }
      stillWaitingChain.awaitingClientRedirect = false;
      stillWaitingChain.awaitingClientRedirectTimer = null;
      if (stillWaitingChain.pendingFinalDetails) {
        scheduleChainFinalization(stillWaitingChain);
      } else {
        cleanupChain(stillWaitingChain);
      }
    }, CLIENT_REDIRECT_GRACE_PERIOD_MS);

    const fromUrl = lastUrl || chain.events.at(-1)?.to || chain.initialUrl;
    chain.events.push({
      timestamp: formatTimestamp(details.timeStamp),
      from: fromUrl,
      to: details.url,
      statusCode: 'JS',
      method: 'CLIENT',
      type: 'client_redirect'
    });

    pendingClientRedirects.set(details.tabId, {
      chainId: chain.id,
      targetUrl: details.url
    });

    startCleanupTimer(chain);
  });
} else {
  console.warn(
    'Redirect Inspector: chrome.webNavigation.onCommitted is unavailable in this context; client-side redirects will not be tracked.'
  );
}
