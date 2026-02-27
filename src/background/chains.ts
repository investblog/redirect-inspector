import { browser } from 'wxt/browser';
import type { Chain, RedirectEvent, RedirectRecord } from '../shared/types/redirect';
import {
  renderAwaitingBadge,
  setBadgeForTab,
  stopAwaitingClientRedirectCountdown,
  updateBadgeForChain,
  updateBadgeForRecord,
} from './badge';
import {
  classifyEventLikeHop,
  classifyRecord,
  eventsDescribeSameHop,
  mergeEventDetails,
  prepareEventsForRecord,
  resolveFinalUrl,
} from './classify';
import {
  ACTIVE_CHAIN_TIMEOUT_MS,
  BADGE_COUNTDOWN_TICK_MS,
  BADGE_SUCCESS_COLOR,
  CHAIN_FINALIZATION_DELAY_MS,
  CLIENT_REDIRECT_AWAIT_TYPES,
  CLIENT_REDIRECT_DEFAULT_AWAIT_MS,
  CLIENT_REDIRECT_EXTENDED_AWAIT_MS,
  formatTimestamp,
  getHeaderValue,
  isNoisyUrl,
  MAX_RECORDS,
  REDIRECT_LOG_KEY,
  sameHost,
} from './helpers';

// ---- State Maps ----

export const chainsById = new Map<string, Chain>();
export const requestToChain = new Map<string, string>();
export const tabChains = new Map<number, string>();
export const tabLastCommittedUrl = new Map<number, string>();
export const pendingClientRedirects = new Map<number, { chainId: string; fromUrl?: string; startedAt: number }>();
export const pendingRedirectTargets = new Map<string, string[]>();

// ---- Chain Event Helpers ----

function appendEventToChain(chain: Chain, event: RedirectEvent): void {
  if (!chain || !event) {
    return;
  }

  const lastIndex = chain.events.length - 1;
  if (lastIndex >= 0) {
    const last = chain.events[lastIndex];
    if (eventsDescribeSameHop(last, event)) {
      chain.events[lastIndex] = mergeEventDetails(last, event);
      return;
    }
  }

  chain.events.push(event);
}

// ---- Storage ----

async function appendRedirectRecord(record: RedirectRecord): Promise<void> {
  try {
    const { [REDIRECT_LOG_KEY]: existing = [] } = await browser.storage.local.get(REDIRECT_LOG_KEY);
    const updated = [record, ...(existing as RedirectRecord[])].slice(0, MAX_RECORDS);
    await browser.storage.local.set({ [REDIRECT_LOG_KEY]: updated });
  } catch (error) {
    console.error('Failed to append redirect record', error);
  }
}

// ---- Chain Lifecycle ----

export function createChain(details: { tabId: number; initiator?: string; timeStamp?: number }): Chain {
  const chain: Chain = {
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
    awaitingClientRedirectDeadline: null,
    awaitingClientRedirectInterval: null,
    awaitingBadgeToggle: false,
    awaitingBadgeFinalColor: null,
    cleanupTimer: null,
    pendingRedirectTargetKeys: new Set(),
  };

  chainsById.set(chain.id, chain);
  return chain;
}

export function getChainByRequestId(requestId: string): Chain | undefined {
  const chainId = requestToChain.get(requestId);
  if (!chainId) {
    return undefined;
  }
  return chainsById.get(chainId);
}

function cancelAwaitingClientRedirect(chain: Chain): void {
  if (!chain?.awaitingClientRedirect) {
    return;
  }

  chain.awaitingClientRedirect = false;
  if (chain.awaitingClientRedirectTimer) {
    clearTimeout(chain.awaitingClientRedirectTimer);
    chain.awaitingClientRedirectTimer = null;
  }

  stopAwaitingClientRedirectCountdown(chain);
  chain.awaitingBadgeFinalColor = null;

  if (typeof chain.tabId === 'number' && chain.tabId >= 0) {
    const pending = pendingClientRedirects.get(chain.tabId);
    if (pending?.chainId === chain.id) {
      pendingClientRedirects.delete(chain.tabId);
    }
  }

  updateBadgeForChain(chain);
}

function getClientRedirectAwaitTimeout(_details: { type?: string }): number {
  return CLIENT_REDIRECT_DEFAULT_AWAIT_MS;
}

function startAwaitingClientRedirect(chain: Chain, fromUrl: string | undefined, timeoutMs: number): void {
  if (!chain) {
    return;
  }

  cancelAwaitingClientRedirect(chain);

  chain.awaitingClientRedirect = true;

  const hasBadgeTarget = typeof chain.tabId === 'number' && chain.tabId >= 0;

  if (hasBadgeTarget) {
    pendingClientRedirects.set(chain.tabId, {
      chainId: chain.id,
      fromUrl: fromUrl || chain.pendingFinalDetails?.details?.url,
      startedAt: Date.now(),
    });
  }

  const waitMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : CLIENT_REDIRECT_DEFAULT_AWAIT_MS;
  chain.awaitingClientRedirectDeadline = Date.now() + waitMs;
  chain.awaitingBadgeToggle = true;
  renderAwaitingBadge(chain);

  if (chain.awaitingClientRedirectInterval) {
    clearInterval(chain.awaitingClientRedirectInterval);
    chain.awaitingClientRedirectInterval = null;
  }

  if (hasBadgeTarget) {
    chain.awaitingClientRedirectInterval = setInterval(() => {
      if (!chain.awaitingClientRedirect) {
        clearInterval(chain.awaitingClientRedirectInterval!);
        chain.awaitingClientRedirectInterval = null;
        return;
      }

      renderAwaitingBadge(chain, { toggle: true });
    }, BADGE_COUNTDOWN_TICK_MS);
  }

  chain.awaitingClientRedirectTimer = setTimeout(() => {
    chain.awaitingClientRedirect = false;
    chain.awaitingClientRedirectTimer = null;

    if (hasBadgeTarget) {
      const pending = pendingClientRedirects.get(chain.tabId);
      if (pending?.chainId === chain.id) {
        pendingClientRedirects.delete(chain.tabId);
      }
    }

    chain.awaitingBadgeFinalColor = BADGE_SUCCESS_COLOR;
    stopAwaitingClientRedirectCountdown(chain);
    updateBadgeForChain(chain);
    scheduleChainFinalization(chain);
  }, waitMs);
}

function startCleanupTimer(chain: Chain): void {
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

export function cleanupChain(chain: Chain): void {
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

  chain.awaitingClientRedirect = false;
  stopAwaitingClientRedirectCountdown(chain);
  chain.awaitingBadgeFinalColor = null;

  if (chain.cleanupTimer) {
    clearTimeout(chain.cleanupTimer);
    chain.cleanupTimer = null;
  }

  if (chain.pendingRedirectTargetKeys?.size) {
    for (const key of chain.pendingRedirectTargetKeys) {
      const queue = pendingRedirectTargets.get(key);
      if (!queue) {
        pendingRedirectTargets.delete(key);
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

export function scheduleChainFinalization(chain: Chain): void {
  if (!chain || chain.awaitingClientRedirect) {
    return;
  }

  if (chain.finalizeTimer) {
    clearTimeout(chain.finalizeTimer);
    chain.finalizeTimer = null;
  }

  const delay = Math.max(CHAIN_FINALIZATION_DELAY_MS, 0);
  if (delay === 0) {
    finalizeChainRecord(chain.id).catch((error) => {
      console.error('Failed to persist redirect chain', error);
    });
    return;
  }

  chain.finalizeTimer = setTimeout(() => {
    chain.finalizeTimer = null;
    finalizeChainRecord(chain.id).catch((error) => {
      console.error('Failed to persist redirect chain', error);
    });
  }, delay);
}

async function finalizeChainRecord(chainId: string): Promise<void> {
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

  const preparedEvents = prepareEventsForRecord(chain.events);
  const normalizedEvents = preparedEvents.normalizedEvents;

  const record: RedirectRecord = {
    id: chain.id,
    requestId: details.requestId,
    tabId: chain.tabId,
    initiator: chain.initiator,
    initiatedAt: chain.initiatedAt,
    completedAt,
    initialUrl: chain.initialUrl || normalizedEvents[0]?.from,
    finalUrl: undefined,
    finalStatus: details.statusCode,
    error: errorMessage || null,
    events: normalizedEvents,
  };

  if (preparedEvents.normalizedNoiseEvents.length > 0) {
    record.noiseEvents = preparedEvents.normalizedNoiseEvents;
  }

  record.finalUrl = resolveFinalUrl(record, details, tabLastCommittedUrl) ?? undefined;

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

  const allEventsNoisy = preparedEvents.allEventsNoisy;

  if (!allEventsNoisy) {
    await appendRedirectRecord(record);
    updateBadgeForRecord(record);
  }

  cleanupChain(chain);
}

export function serializeChainPreview(chain: Chain): RedirectRecord | null {
  if (!chain) {
    return null;
  }

  const prepared = prepareEventsForRecord(chain.events);
  const normalizedEvents = prepared.normalizedEvents;

  const pendingDetails = chain.pendingFinalDetails?.details || null;

  let completedAt: string | undefined;
  if (typeof pendingDetails?.timeStamp === 'number') {
    completedAt = formatTimestamp(pendingDetails.timeStamp);
  }

  const record: RedirectRecord = {
    id: chain.id,
    tabId: chain.tabId,
    initiator: chain.initiator,
    initiatedAt: chain.initiatedAt,
    completedAt: completedAt || undefined,
    initialUrl: chain.initialUrl || normalizedEvents[0]?.from,
    finalUrl: pendingDetails?.url || normalizedEvents.at(-1)?.to || normalizedEvents.at(-1)?.from || chain.initialUrl,
    finalStatus: pendingDetails?.statusCode,
    error: chain.pendingFinalDetails?.errorMessage || null,
    events: normalizedEvents,
    pending: true,
  };

  if (prepared.normalizedNoiseEvents.length > 0) {
    record.noiseEvents = prepared.normalizedNoiseEvents;
  }

  if (chain.awaitingClientRedirect) {
    record.awaitingClientRedirect = true;
    if (typeof chain.awaitingClientRedirectDeadline === 'number') {
      record.awaitingClientRedirectDeadline = chain.awaitingClientRedirectDeadline;
    }
  }

  return record;
}

// ---- Attach / Record / Consume ----

export function attachRequestToChain(
  chain: Chain,
  details: {
    requestId: string;
    tabId: number;
    initiator?: string;
  },
): Chain {
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

function createRedirectTargetKey(tabId: number, url: string): { tabKey: string; anyKey: string } | null {
  if (!url) {
    return null;
  }

  const hasTab = typeof tabId === 'number' && tabId >= 0;
  const tabKey = `${hasTab ? tabId : 'no-tab'}::${url}`;
  const anyKey = `any-tab::${url}`;
  return { tabKey, anyKey };
}

function consumeQueueByKey(key: string): Chain | null {
  if (!key) return null;

  const queue = pendingRedirectTargets.get(key);
  if (!Array.isArray(queue) || queue.length === 0) {
    return null;
  }

  let chain: Chain | null = null;

  while (queue.length > 0 && !chain) {
    const chainId = queue.shift()!;
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

function consumePendingRedirectTarget(details: { tabId: number; url: string }): Chain | null {
  const keys = createRedirectTargetKey(details.tabId, details.url);
  if (!keys) return null;

  const { tabKey, anyKey } = keys;

  let chain = consumeQueueByKey(tabKey);
  if (chain) return chain;

  chain = consumeQueueByKey(anyKey);
  if (chain) {
    if (chain.initialUrl && !sameHost(chain.initialUrl, details.url)) {
      return null;
    }
    return chain;
  }

  return null;
}

export function recordRedirectEvent(details: chrome.webRequest.WebRedirectionResponseDetails): void {
  let chain = getChainByRequestId(details.requestId);
  if (!chain) {
    chain = createChain(details);
  }

  attachRequestToChain(chain, details);

  if (!chain.initialUrl) {
    chain.initialUrl = details.url;
  }

  if (details.redirectUrl) {
    const keys = createRedirectTargetKey(details.tabId, details.redirectUrl);
    if (keys) {
      const { tabKey, anyKey } = keys;

      if (tabKey) {
        const q1 = pendingRedirectTargets.get(tabKey) || [];
        q1.push(chain.id);
        pendingRedirectTargets.set(tabKey, q1);
        chain.pendingRedirectTargetKeys.add(tabKey);
      }

      if (!(typeof details.tabId === 'number' && details.tabId >= 0)) {
        if (!chain.initialUrl || chain.initialUrl === details.url) {
          const q2 = pendingRedirectTargets.get(anyKey) || [];
          q2.push(chain.id);
          pendingRedirectTargets.set(anyKey, q2);
          chain.pendingRedirectTargetKeys.add(anyKey);
        }
      }
    }
  }

  // Chrome reports statusCode 0 for internal redirects (HSTS http→https upgrade)
  const isInternalRedirect =
    details.statusCode === 0 && details.url.startsWith('http://') && details.redirectUrl?.startsWith('https://');

  const rawEvent: RedirectEvent = {
    timestamp: formatTimestamp(details.timeStamp),
    timestampMs: typeof details.timeStamp === 'number' ? details.timeStamp : undefined,
    from: details.url,
    to: details.redirectUrl,
    statusCode: isInternalRedirect ? 'HSTS' : details.statusCode,
    method: details.method,
    ip: details.ip,
    type: details.type,
  };

  const classifiedEvent = classifyEventLikeHop(rawEvent);

  appendEventToChain(chain, classifiedEvent);

  updateBadgeForChain(chain);
}

export async function finalizeChain(
  details: chrome.webRequest.WebResponseCacheDetails,
  errorMessage?: string,
): Promise<void> {
  const chain = getChainByRequestId(details.requestId);

  if (!chain || chain.events.length === 0) {
    if (chain) {
      cleanupChain(chain);
    }
    return;
  }

  if (chain.awaitingClientRedirect && details && details.type && details.type !== 'main_frame') {
    return;
  }

  startCleanupTimer(chain);

  chain.pendingFinalDetails = {
    details: {
      requestId: details.requestId,
      tabId: details.tabId,
      url: details.url,
      type: details.type,
      statusCode: details.statusCode,
      timeStamp: details.timeStamp,
      responseHeaders: (details as chrome.webRequest.WebResponseHeadersDetails).responseHeaders,
    },
    errorMessage: errorMessage || null,
  };

  // Noisy URLs (Cloudflare challenges, analytics, etc.) — finalize immediately, never await
  if (isNoisyUrl(details.url)) {
    scheduleChainFinalization(chain);
    return;
  }

  const canAwaitClientRedirect =
    typeof details.tabId === 'number' &&
    details.tabId >= 0 &&
    (!details.type || CLIENT_REDIRECT_AWAIT_TYPES.has(details.type));

  const contentType =
    getHeaderValue((details as chrome.webRequest.WebResponseHeadersDetails).responseHeaders, 'content-type') || '';
  const isHtmlPage =
    typeof contentType === 'string' &&
    contentType.toLowerCase().includes('text/html') &&
    details.statusCode === 200 &&
    (details.type === 'main_frame' || details.type === 'sub_frame');

  if (canAwaitClientRedirect || isHtmlPage) {
    const awaitTimeout = isHtmlPage ? CLIENT_REDIRECT_EXTENDED_AWAIT_MS : getClientRedirectAwaitTimeout(details);
    startAwaitingClientRedirect(chain, details.url, awaitTimeout);
  } else {
    scheduleChainFinalization(chain);
  }
}

export function handleBeforeRedirect(details: chrome.webRequest.WebRedirectionResponseDetails): void {
  try {
    recordRedirectEvent(details);
  } catch (error) {
    console.error('Failed to record redirect event', error, details);
  }
}

export function handleBeforeRequest(details: chrome.webRequest.WebRequestBodyDetails): void {
  try {
    let chain = getChainByRequestId(details.requestId);

    if (!chain) {
      chain = consumePendingRedirectTarget(details) ?? undefined;
    }

    if (!chain && typeof details.tabId === 'number' && details.tabId >= 0 && details.type === 'main_frame') {
      const pending = pendingClientRedirects.get(details.tabId);
      if (pending) {
        const candidate = chainsById.get(pending.chainId);
        if (candidate) {
          const fromUrl =
            pending.fromUrl ||
            candidate.pendingFinalDetails?.details?.url ||
            candidate.events.at(-1)?.to ||
            tabLastCommittedUrl.get(details.tabId) ||
            candidate.initialUrl;

          // Only treat as client redirect if the new URL is related to the chain.
          // Navigation to a completely different domain is a new user action, not a redirect.
          const isRelated = fromUrl ? sameHost(fromUrl, details.url) : false;

          if (isRelated) {
            chain = candidate;

            const rawClientEvent: RedirectEvent = {
              timestamp: formatTimestamp(details.timeStamp),
              timestampMs: typeof details.timeStamp === 'number' ? details.timeStamp : undefined,
              from: fromUrl || '',
              to: details.url,
              statusCode: 'JS',
              method: 'CLIENT',
              type: 'client-redirect',
            };
            const classifiedClientEvent = classifyEventLikeHop(rawClientEvent);

            appendEventToChain(candidate, classifiedClientEvent);

            candidate.pendingFinalDetails = null;
            cancelAwaitingClientRedirect(candidate);
            updateBadgeForChain(candidate);
          } else {
            // Different domain — finalize the old chain and let this start fresh
            scheduleChainFinalization(candidate);
            pendingClientRedirects.delete(details.tabId);
          }
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

export function handleRequestCompleted(details: chrome.webRequest.WebResponseCacheDetails): void {
  try {
    finalizeChain(details);
  } catch (error) {
    console.error('Failed to finalize redirect chain', error, details);
  }
}

export function handleRequestError(details: chrome.webRequest.WebResponseErrorDetails): void {
  try {
    const message = details?.error || 'Unknown network error';
    finalizeChain(details as unknown as chrome.webRequest.WebResponseCacheDetails, message);
  } catch (error) {
    console.error('Failed to finalize redirect chain after error', error, details);
  }
}

export function cleanupTabState(tabId: number): void {
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

export function handleWebNavigationCommitted(
  details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
): void {
  if (typeof details.tabId !== 'number' || details.tabId < 0) {
    return;
  }

  tabLastCommittedUrl.set(details.tabId, details.url);

  if (details.frameId === 0) {
    const pending = pendingClientRedirects.get(details.tabId);
    if (pending) {
      const chain = chainsById.get(pending.chainId);
      if (chain?.awaitingClientRedirect) {
        const fromUrl =
          pending.fromUrl ||
          chain.pendingFinalDetails?.details?.url ||
          chain.events.at(-1)?.to ||
          chain.initialUrl ||
          '';

        // If navigation goes to a different domain, it's user action — just finalize
        const isRelatedDomain = fromUrl ? sameHost(fromUrl, details.url) : false;

        if (isRelatedDomain) {
          const lastNonNoisy = [...chain.events].reverse().find((e) => !e.noise && e.to);
          const lastTarget = lastNonNoisy?.to || chain.events.at(-1)?.to;

          let isBackwardHop = false;
          if (lastTarget && details.url) {
            try {
              const a = new URL(lastTarget);
              const b = new URL(details.url);
              isBackwardHop = a.hostname === b.hostname && a.pathname === b.pathname;
            } catch {
              /* ignore */
            }
          }

          if (!isBackwardHop) {
            const clientHop = classifyEventLikeHop({
              timestamp: formatTimestamp(details.timeStamp),
              timestampMs: typeof details.timeStamp === 'number' ? details.timeStamp : undefined,
              from: fromUrl,
              to: details.url,
              statusCode: 'JS',
              method: 'CLIENT',
              type: 'client-redirect',
            });

            appendEventToChain(chain, clientHop);
          }
        }

        cancelAwaitingClientRedirect(chain);
        chain.pendingFinalDetails = {
          details: {
            requestId: chain.id,
            tabId: details.tabId,
            url: isRelatedDomain ? details.url : fromUrl,
            type: 'main_frame',
            statusCode: 200,
            timeStamp: details.timeStamp || Date.now(),
            responseHeaders: [],
          },
          errorMessage: null,
        };
        scheduleChainFinalization(chain);
      }

      pendingClientRedirects.delete(details.tabId);
    }
  }

  const activeChainId = tabChains.get(details.tabId);
  if (activeChainId) {
    const activeChain = chainsById.get(activeChainId);
    if (activeChain) {
      updateBadgeForChain(activeChain);
      return;
    }
  }

  setBadgeForTab(details.tabId, 0);
}
