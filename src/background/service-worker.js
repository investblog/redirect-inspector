const REDIRECT_LOG_KEY = 'redirectLog';
const MAX_RECORDS = 50;
const ACTIVE_CHAIN_TIMEOUT_MS = 5 * 60 * 1000; // Clean up stale chains after 5 minutes.

const activeChains = new Map();

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
    ip: details.ip
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
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onErrorOccurred.addListener(
  async (details) => {
    await finalizeChain(details, details.error);
  },
  { urls: ['<all_urls>'] }
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
