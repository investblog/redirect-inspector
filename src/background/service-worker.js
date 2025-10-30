// src/background/service-worker.js

const REDIRECT_LOG_KEY = 'redirectLog';
const MAX_RECORDS = 50;
const ACTIVE_CHAIN_TIMEOUT_MS = 5 * 60 * 1000; // Clean up stale chains after 5 minutes.
const CLIENT_REDIRECT_GRACE_PERIOD_MS = 1500;

const TRACKING_KEYWORDS = ['pixel', 'track', 'collect', 'analytics', 'impression', 'beacon', 'measure'];
const PIXEL_EXTENSIONS = ['.gif', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.svg'];

const CLIENT_REDIRECT_AWAIT_TYPES = new Set(['main_frame', 'sub_frame', 'script', 'xmlhttprequest', 'other']);

const chainsById = new Map();
const requestToChain = new Map();
const tabChains = new Map();
const tabLastCommittedUrl = new Map();
const pendingClientRedirects = new Map();
const pendingRedirectTargets = new Map();

const WEB_REQUEST_FILTER = { urls: ['<all_urls>'] };
const WEB_REQUEST_EXTRA_INFO_SPEC = ['responseHeaders'];

const BADGE_MAX_COUNT = 99;
const BADGE_COLOR = '#2563eb';

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

function formatBadgeText(count) {
  if (!Number.isFinite(count) || count <= 0) {
    return '';
  }

  if (count > BADGE_MAX_COUNT) {
    return `${BADGE_MAX_COUNT}+`;
  }

  return String(count);
}

function setBadgeForTab(tabId, hopCount) {
  if (!chrome?.action?.setBadgeText) {
    return;
  }

  if (typeof tabId !== 'number' || tabId < 0) {
    return;
  }

  const text = formatBadgeText(hopCount);
  chrome.action.setBadgeText({ tabId, text });

  if (text && chrome?.action?.setBadgeBackgroundColor) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
  }
}

async function clearAllBadges() {
  if (!chrome?.action?.setBadgeText) {
    return;
  }

  if (!chrome?.tabs?.query) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map((tab) => {
        if (typeof tab.id !== 'number') {
          return Promise.resolve();
        }

        return chrome.action.setBadgeText({ tabId: tab.id, text: '' });
      })
    );
  } catch (error) {
    console.error('Failed to clear badge text', error);
  }
}

function updateBadgeForRecord(record) {
  if (!record) {
    return;
  }

  const hopCount = Array.isArray(record.events) ? record.events.length : 0;
  setBadgeForTab(record.tabId, hopCount);
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
    cleanupTimer: null,
    pendingRedirectTargetKeys: new Set()
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

  if (typeof chain.tabId === 'number' && chain.tabId >= 0) {
    const pending = pendingClientRedirects.get(chain.tabId);
    if (pending?.chainId === chain.id) {
      pendingClientRedirects.delete(chain.tabId);
    }
  }
}

function startAwaitingClientRedirect(chain, fromUrl) {
  if (!chain) {
    return;
  }

  cancelAwaitingClientRedirect(chain);

  chain.awaitingClientRedirect = true;

  if (typeof chain.tabId === 'number' && chain.tabId >= 0) {
    pendingClientRedirects.set(chain.tabId, {
      chainId: chain.id,
      fromUrl: fromUrl || chain.pendingFinalDetails?.details?.url,
      startedAt: Date.now()
    });
  }

  chain.awaitingClientRedirectTimer = setTimeout(() => {
    chain.awaitingClientRedirect = false;
    chain.awaitingClientRedirectTimer = null;

    if (typeof chain.tabId === 'number' && chain.tabId >= 0) {
      const pending = pendingClientRedirects.get(chain.tabId);
      if (pending?.chainId === chain.id) {
        pendingClientRedirects.delete(chain.tabId);
      }
    }

    scheduleChainFinalization(chain);
  }, CLIENT_REDIRECT_GRACE_PERIOD_MS);
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

  if (chain.pendingRedirectTargetKeys?.size) {
    for (const key of chain.pendingRedirectTargetKeys) {
      const queue = pendingRedirectTargets.get(key);
      if (!queue) {
        continue;
      }

      const filtered = queue.filter((chainId) => chainId !== chain.id);
      if (filtered.length === 0) {
        pendingRedirectTargets.delete(key);
      } else {
        pendingRedirectTargets.set(key, filtered);
      }
    }

    chain.pendingRedirectTargetKeys.clear();
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
  updateBadgeForRecord(record);
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

  if (details.redirectUrl) {
    const key = createRedirectTargetKey(details.tabId, details.redirectUrl);
    const queue = pendingRedirectTargets.get(key) || [];
    queue.push(chain.id);
    pendingRedirectTargets.set(key, queue);
    chain.pendingRedirectTargetKeys.add(key);
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

  const canAwaitClientRedirect =
    typeof details.tabId === 'number' &&
    details.tabId >= 0 &&
    (!details.type || CLIENT_REDIRECT_AWAIT_TYPES.has(details.type));

  if (canAwaitClientRedirect) {
    startAwaitingClientRedirect(chain, details.url);
  } else {
    scheduleChainFinalization(chain);
  }
}

function createRedirectTargetKey(tabId, url) {
  if (!url) {
    return null;
  }

  const normalizedTabId = typeof tabId === 'number' && tabId >= 0 ? tabId : 'no-tab';
  return `${normalizedTabId}::${url}`;
}

function consumePendingRedirectTarget(details) {
  const key = createRedirectTargetKey(details.tabId, details.url);
  if (!key) {
    return null;
  }

  const queue = pendingRedirectTargets.get(key);
  if (!Array.isArray(queue) || queue.length === 0) {
    return null;
  }

  let chain = null;

  while (queue.length > 0 && !chain) {
    const chainId = queue.shift();
    const candidate = chainsById.get(chainId);
    if (candidate) {
      candidate.pendingRedirectTargetKeys.delete(key);
      chain = candidate;
    }
  }

  if (queue.length > 0) {
    pendingRedirectTargets.set(key, queue);
  } else {
    pendingRedirectTargets.delete(key);
  }

  return chain;
}

function handleBeforeRedirect(details) {
  try {
    recordRedirectEvent(details);
  } catch (error) {
    console.error('Failed to record redirect event', error, details);
  }
}

function handleBeforeRequest(details) {
  try {
    let chain = getChainByRequestId(details.requestId);

    if (!chain) {
      chain = consumePendingRedirectTarget(details);
    }

    if (!chain && typeof details.tabId === 'number' && details.tabId >= 0 && details.type === 'main_frame') {
      const pending = pendingClientRedirects.get(details.tabId);
      if (pending) {
        const candidate = chainsById.get(pending.chainId);
        if (candidate) {
          chain = candidate;

          const fromUrl =
            pending.fromUrl ||
            candidate.pendingFinalDetails?.details?.url ||
            candidate.events.at(-1)?.to ||
            tabLastCommittedUrl.get(details.tabId) ||
            candidate.initialUrl;
          candidate.events.push({
            timestamp: formatTimestamp(details.timeStamp),
            from: fromUrl,
            to: details.url,
            statusCode: 'JS',
            method: 'CLIENT',
            type: 'client-redirect'
          });

          candidate.pendingFinalDetails = null;
          cancelAwaitingClientRedirect(candidate);
        } else {
          pendingClientRedirects.delete(details.tabId);
        }
      }
    }

    if (!chain) {
      return;
    }

    attachRequestToChain(chain, details);

    if (!chain.initialUrl) {
      chain.initialUrl = details.url;
    }
  } catch (error) {
    console.error('Failed to attach request to redirect chain', error, details);
  }
}

function handleRequestCompleted(details) {
  try {
    finalizeChain(details);
  } catch (error) {
    console.error('Failed to finalize redirect chain', error, details);
  }
}

function handleRequestError(details) {
  try {
    const message = details?.error || 'Unknown network error';
    finalizeChain(details, message);
  } catch (error) {
    console.error('Failed to finalize redirect chain after error', error, details);
  }
}

function cleanupTabState(tabId) {
  tabLastCommittedUrl.delete(tabId);
  pendingClientRedirects.delete(tabId);
  setBadgeForTab(tabId, 0);

  const chainId = tabChains.get(tabId);
  if (!chainId) {
    return;
  }

  const chain = chainsById.get(chainId);
  if (chain) {
    cleanupChain(chain);
  } else {
    tabChains.delete(tabId);
  }
}

// ---- EVENT REGISTRATION ----
try {
  if (chrome?.webRequest?.onBeforeRequest) {
    chrome.webRequest.onBeforeRequest.addListener(handleBeforeRequest, WEB_REQUEST_FILTER);
  }

  if (chrome?.webRequest?.onBeforeRedirect) {
    chrome.webRequest.onBeforeRedirect.addListener(handleBeforeRedirect, WEB_REQUEST_FILTER, WEB_REQUEST_EXTRA_INFO_SPEC);
  }

  if (chrome?.webRequest?.onCompleted) {
    chrome.webRequest.onCompleted.addListener(handleRequestCompleted, WEB_REQUEST_FILTER, WEB_REQUEST_EXTRA_INFO_SPEC);
  }

  if (chrome?.webRequest?.onErrorOccurred) {
    chrome.webRequest.onErrorOccurred.addListener(handleRequestError, WEB_REQUEST_FILTER);
  }
} catch (error) {
  console.error('Failed to register webRequest listeners', error);
}

if (chrome?.webNavigation?.onCommitted) {
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (typeof details.tabId === 'number' && details.tabId >= 0) {
      tabLastCommittedUrl.set(details.tabId, details.url);
      setBadgeForTab(details.tabId, 0);
    }
  });
}

if (chrome?.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    cleanupTabState(tabId);
  });
}

// ---- RUNTIME MESSAGES (popup <-> background) ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // всегда стараемся отвечать, чтобы не было "Receiving end does not exist"
  const type = message && message.type;

  // 1. отдать лог
  if (type === 'redirect-inspector:get-log') {
    chrome.storage.local
      .get({ [REDIRECT_LOG_KEY]: [] })
      .then((result) => {
        sendResponse({ log: result[REDIRECT_LOG_KEY] });
      })
      .catch((error) => {
        console.error('Failed to read redirect log', error);
        sendResponse({ log: [], error: error?.message || 'Unknown error' });
      });

    // говорим Chrome, что ответ будет асинхронно
    return true;
  }

  // 2. очистить лог (именно то, что сейчас шлёт попап)
  if (type === 'redirect-inspector:clear-log') {
    chrome.storage.local
      .set({ [REDIRECT_LOG_KEY]: [] })
      .then(() => {
        clearAllBadges();
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Failed to clear redirect log', error);
        sendResponse({ success: false, error: error?.message || 'Unknown error' });
      });

    return true;
  }

  // 3. на всякий случай поддержим старое/альтернативное имя
  if (type === 'redirect-inspector:clear-redirects') {
    chrome.storage.local
      .set({ [REDIRECT_LOG_KEY]: [] })
      .then(() => {
        clearAllBadges();
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Failed to clear redirect log', error);
        sendResponse({ success: false, error: error?.message || 'Unknown error' });
      });

    return true;
  }

  // если прилетело что-то другое — всё равно отвечаем,
  // чтобы не было "Receiving end does not exist"
  sendResponse({ ok: false, error: 'Unknown message type' });
  return false;
});
