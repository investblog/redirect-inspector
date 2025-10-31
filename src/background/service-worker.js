// src/background/service-worker.js

// --- storage / limits ---
const REDIRECT_LOG_KEY = 'redirectLog';
const MAX_RECORDS = 50;
const ACTIVE_CHAIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 минут

// --- ожидание клиентских редиректов ---
const CLIENT_REDIRECT_DEFAULT_AWAIT_MS = 10 * 1000;
const CLIENT_REDIRECT_EXTENDED_AWAIT_MS = 45 * 1000;
const CLIENT_REDIRECT_EXTENDED_TYPES = new Set(['script', 'xmlhttprequest', 'other']);

// задержка, чтобы не рвать цепочку
const CHAIN_FINALIZATION_DELAY_MS = 250;

// --- эвристики трекинга ---
const TRACKING_KEYWORDS = ['pixel', 'track', 'collect', 'analytics', 'impression', 'beacon', 'measure'];
const PIXEL_EXTENSIONS = ['.gif', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.svg'];

// какие типы могут порождать клиентский редирект
const CLIENT_REDIRECT_AWAIT_TYPES = new Set(['main_frame', 'sub_frame', 'script', 'xmlhttprequest', 'other']);

// --- глобальные коллекции цепочек ---
const chainsById = new Map();
const requestToChain = new Map();
const tabChains = new Map();
const tabLastCommittedUrl = new Map();
const pendingClientRedirects = new Map();
const pendingRedirectTargets = new Map();

// --- webRequest настройки ---
const WEB_REQUEST_FILTER = { urls: ['<all_urls>'] };
const WEB_REQUEST_EXTRA_INFO_SPEC = ['responseHeaders'];

// --- badge ---
const BADGE_MAX_COUNT = 99;
const BADGE_COLOR = '#2563eb';
const BADGE_COUNTDOWN_COLOR = '#dc2626';
const BADGE_COUNTDOWN_TICK_MS = 1000;

// --- какие расширения считаем "не навигацией" ---
const NON_NAVIGABLE_EXTENSIONS = ['.js', '.mjs'];
const LIKELY_BROWSER_PROTOCOLS = new Set(['http:', 'https:']);

// ===================================================================
//  ЕДИНЫЙ СПИСОК СЕРВИСНЫХ / ШУМНЫХ ХОСТОВ И ПУТЕЙ
//  (его же используем в popup.js)
// ===================================================================
const NOISY_HOSTS = [
  // Cloudflare
  'cloudflareinsights.com',
  'cf-ns.com',
  'cdn.cloudflare.net',
  // Google / GA
  'www.googletagmanager.com',
  'googletagmanager.com',
  'www.google-analytics.com',
  'google-analytics.com',
  'stats.g.doubleclick.net',
  // Meta
  'connect.facebook.net',
  'graph.facebook.com',
  'www.facebook.com',
  // Yandex
  'mc.yandex.ru',
  'yastatic.net',
  'yandex.ru',
  'safeframe.yastatic.net',
  // VK / Mail
  'vk.com',
  'api.vk.com',
  'id.vk.com',
  'auth.mail.ru',
  // рекламные / баннерные cdn
  'doubleclick.net',
  'ads.pubmatic.com',
  // твои конкретные
  'strm.yandex.net'
];

// части путей, которые часто шума
const NOISY_PATH_PARTS = [
  '/cdn-cgi/challenge-platform/',
  '/cdn-cgi/challenge/',
  '/cdn-cgi/bm/',
  '/cdn-cgi/trace',
  '/cdn-cgi/zaraz/',
  '/cdn-cgi/scripts/',
  '/safeframe-bundles/',
  '/gtm.js',
  '/analytics.js'
];

// медиатипы / вспомогательные запросы
const NOISY_RESOURCE_TYPES = new Set([
  'media',
  'script',
  'stylesheet',
  'font',
  'imageset',
  'object',
  'other',
  'ping',
  'csp_report',
  'xmlhttprequest' // часто трекинг
]);

// хосты, которые считаем "авторизационными" и можем показывать, даже если это hop
const AUTH_HOP_HOSTS = [
  // Яндекс
  'passport.yandex.ru',
  'sso.yandex.ru',
  // Google
  'accounts.google.com',
  // Meta / Facebook
  'facebook.com',
  'm.facebook.com',
  'login.facebook.com',
  // VK / Mail
  'login.vk.com',
  'id.vk.com',
  'auth.mail.ru',
  // Telegram / Discord / Twitch
  'oauth.telegram.org',
  'discord.com',
  'id.twitch.tv',
  // Microsoft
  'login.live.com',
  'login.microsoftonline.com',
  // Apple
  'appleid.apple.com',
  // Steam / Epic
  'steamcommunity.com',
  'store.steampowered.com',
  'www.epicgames.com',
  // crypto / sso
  'accounts.binance.com',
  'sso.binance.com',
  'login.coinbase.com'
];

// ===================================================================
//  helpers
// ===================================================================
function isNoisyUrl(raw) {
  if (!raw) return false;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }

  const host = u.hostname;
  // сверяем с сервисными хостами
  if (
    NOISY_HOSTS.some((svc) => host === svc || host.endsWith('.' + svc))
  ) {
    return true;
  }

  // сверяем с сервисными путями
  const path = u.pathname || '';
  if (NOISY_PATH_PARTS.some((part) => path.includes(part))) {
    return true;
  }

  return false;
}

function isNoisyRecord(record) {
  // 1) если уже помечен бэкграундом
  if (record.classification === 'likely-tracking') {
    return true;
  }

  const events = Array.isArray(record.events) ? record.events : [];
  if (!events.length) return false;

  // 2) если все шаги — тех.типы (медиа, скрипты и т.п.)
  const allNoisyType = events.every((e) => e.type && NOISY_RESOURCE_TYPES.has(e.type));
  if (allNoisyType) {
    return true;
  }

  // 3) если все урлы сервисные/статические
  const allNoisyUrl = events.every((e) => {
    const u = e.to || e.from;
    return u && isNoisyUrl(u);
  });
  if (allNoisyUrl) {
    return true;
  }

  return false;
}

function getHeaderValue(headers = [], headerName) {
  if (!Array.isArray(headers) || !headerName) return undefined;
  const target = headerName.toLowerCase();
  const match = headers.find((header) => header?.name?.toLowerCase() === target);
  return match?.value;
}

function parseContentLength(value) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function hasTrackingKeyword(url) {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  return TRACKING_KEYWORDS.some((kw) => lowerUrl.includes(kw));
}

function hasPixelExtension(url) {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  return PIXEL_EXTENSIONS.some((ext) => lowerUrl.endsWith(ext));
}

function formatBadgeText(count) {
  if (!Number.isFinite(count) || count <= 0) return '';
  if (count > BADGE_MAX_COUNT) return `${BADGE_MAX_COUNT}+`;
  return String(count);
}

function handleChromePromise(promise, context) {
  if (!promise || typeof promise.catch !== 'function') return;
  promise.catch((error) => {
    if (error?.message && error.message.includes('No tab with id')) return;
    if (context) {
      console.error(context, error);
    } else {
      console.error('Chrome API call failed', error);
    }
  });
}

function setBadgeForTab(tabId, hopCount, options = {}) {
  if (!chrome?.action?.setBadgeText) return;
  if (typeof tabId !== 'number' || tabId < 0) return;

  const text = typeof options.text === 'string' ? options.text : formatBadgeText(hopCount);
  try {
    const res = chrome.action.setBadgeText({ tabId, text });
    handleChromePromise(res, 'Failed to set badge text');
  } catch (error) {
    if (!error?.message || !error.message.includes('No tab with id')) {
      console.error('Failed to set badge text', error);
    }
    return;
  }

  if (text && chrome?.action?.setBadgeBackgroundColor) {
    try {
      const color = options.color || BADGE_COLOR;
      const res = chrome.action.setBadgeBackgroundColor({ tabId, color });
      handleChromePromise(res, 'Failed to set badge background color');
    } catch (error) {
      if (!error?.message || !error.message.includes('No tab with id')) {
        console.error('Failed to set badge background color', error);
      }
    }
  }
}

async function clearAllBadges() {
  if (!chrome?.action?.setBadgeText) return;

  if (!chrome?.tabs?.query) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map((tab) => {
        if (typeof tab.id !== 'number') return Promise.resolve();
        return chrome.action.setBadgeText({ tabId: tab.id, text: '' });
      })
    );
  } catch (error) {
    console.error('Failed to clear badge text', error);
  }
}

function updateBadgeForChain(chain) {
  if (!chain) return;

  if (chain.awaitingClientRedirect && chain.awaitingClientRedirectDeadline) {
    renderAwaitingBadge(chain);
    return;
  }

  const hopCount = Array.isArray(chain.events) ? chain.events.length : 0;
  setBadgeForTab(chain.tabId, hopCount);
}

function renderAwaitingBadge(chain, options = {}) {
  if (!chain) return;

  if (options.toggle) {
    chain.awaitingBadgeToggle = !chain.awaitingBadgeToggle;
  }

  const hopCount = Array.isArray(chain.events) ? chain.events.length : 0;

  if (typeof chain.tabId !== 'number' || chain.tabId < 0) return;

  const deadline = typeof chain.awaitingClientRedirectDeadline === 'number' ? chain.awaitingClientRedirectDeadline : null;
  if (!deadline) {
    setBadgeForTab(chain.tabId, hopCount);
    return;
  }

  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    setBadgeForTab(chain.tabId, hopCount);
    return;
  }

  if (chain.awaitingBadgeToggle) {
    const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    setBadgeForTab(chain.tabId, hopCount, { text: String(remainingSeconds), color: BADGE_COUNTDOWN_COLOR });
    return;
  }

  setBadgeForTab(chain.tabId, hopCount);
}

function stopAwaitingClientRedirectCountdown(chain) {
  if (!chain) return;

  if (chain.awaitingClientRedirectInterval) {
    clearInterval(chain.awaitingClientRedirectInterval);
    chain.awaitingClientRedirectInterval = null;
  }

  chain.awaitingClientRedirectDeadline = null;
  chain.awaitingBadgeToggle = false;
}

function updateBadgeForRecord(record) {
  if (!record) return;
  const hopCount = Array.isArray(record.events) ? record.events.length : 0;
  setBadgeForTab(record.tabId, hopCount);
}

function isLikelyBrowserUrl(url) {
  if (!url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    return false;
  }

  const pathname = (parsed.pathname || '').toLowerCase();
  if (!LIKELY_BROWSER_PROTOCOLS.has(parsed.protocol)) {
    return false;
  }

  if (NON_NAVIGABLE_EXTENSIONS.some((extension) => pathname.endsWith(extension))) {
    return false;
  }

  return true;
}

function isNoisyFinalCandidate(url) {
  return isNoisyUrl(url);
}

// --- resolveFinalUrl ---
function resolveFinalUrl(record, completionDetails) {
  const completionType = completionDetails?.type;
  const completionUrl = completionDetails?.url;

  const candidates = [];
  const isNavigationCompletion = completionType === 'main_frame' || completionType === 'sub_frame';

  if (isNavigationCompletion && completionUrl) {
    candidates.push(completionUrl);
  }

  if (Array.isArray(record.events) && record.events.length > 0) {
    const navigationalEvent = [...record.events]
      .reverse()
      .find(
        (event) =>
          event?.to &&
          (event.type === 'client-redirect' || event.type === 'main_frame' || event.method === 'CLIENT')
      );

    if (navigationalEvent?.to) {
      candidates.push(navigationalEvent.to);
    }

    const lastEvent = record.events.at(-1);
    if (lastEvent?.to) {
      candidates.push(lastEvent.to);
    }
  }

  if (typeof record.tabId === 'number' && record.tabId >= 0) {
    const committedUrl = tabLastCommittedUrl.get(record.tabId);
    if (committedUrl) {
      candidates.push(committedUrl);
    }
  }

  if (completionUrl) {
    candidates.push(completionUrl);
  }

  if (record.initialUrl) {
    candidates.push(record.initialUrl);
  }

  const uniqueCandidates = candidates.filter((candidate, index) => candidate && candidates.indexOf(candidate) === index);

  // 1) нормальный браузерный и не шумный
  const preferred = uniqueCandidates.find(
    (candidate) => isLikelyBrowserUrl(candidate) && !isNoisyFinalCandidate(candidate)
  );
  if (preferred) {
    return preferred;
  }

  // 2) нормальный браузерный
  const fallbackBrowser = uniqueCandidates.find((candidate) => isLikelyBrowserUrl(candidate));
  if (fallbackBrowser) {
    return fallbackBrowser;
  }

  // 3) любой
  if (uniqueCandidates.length > 0) {
    return uniqueCandidates[0];
  }

  if (typeof record.tabId === 'number' && record.tabId >= 0) {
    const committedUrl = tabLastCommittedUrl.get(record.tabId);
    if (committedUrl) {
      return committedUrl;
    }
  }

  if (record.initialUrl) {
    return record.initialUrl;
  }

  if (completionUrl) {
    return completionUrl;
  }

  return null;
}

// --- классификация цепочки ---
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

  if (isNoisyUrl(finalUrl)) {
    heuristics.push('noisy url (cf/analytics/static)');
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

// ===================================================================
//  chain lifecycle
// ===================================================================
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
    awaitingClientRedirectDeadline: null,
    awaitingClientRedirectInterval: null,
    awaitingBadgeToggle: false,
    cleanupTimer: null,
    pendingRedirectTargetKeys: new Set()
  };

  chainsById.set(chain.id, chain);
  return chain;
}

function getChainByRequestId(requestId) {
  const chainId = requestToChain.get(requestId);
  if (!chainId) return undefined;
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

  stopAwaitingClientRedirectCountdown(chain);

  if (typeof chain.tabId === 'number' && chain.tabId >= 0) {
    const pending = pendingClientRedirects.get(chain.tabId);
    if (pending?.chainId === chain.id) {
      pendingClientRedirects.delete(chain.tabId);
    }
  }

  updateBadgeForChain(chain);
}

function getClientRedirectAwaitTimeout(details) {
  if (!details?.type) {
    return CLIENT_REDIRECT_DEFAULT_AWAIT_MS;
  }

  if (CLIENT_REDIRECT_EXTENDED_TYPES.has(details.type)) {
    return CLIENT_REDIRECT_EXTENDED_AWAIT_MS;
  }

  return CLIENT_REDIRECT_DEFAULT_AWAIT_MS;
}

function startAwaitingClientRedirect(chain, fromUrl, timeoutMs) {
  if (!chain) return;

  cancelAwaitingClientRedirect(chain);

  chain.awaitingClientRedirect = true;

  const hasBadgeTarget = typeof chain.tabId === 'number' && chain.tabId >= 0;

  if (hasBadgeTarget) {
    pendingClientRedirects.set(chain.tabId, {
      chainId: chain.id,
      fromUrl: fromUrl || chain.pendingFinalDetails?.details?.url,
      startedAt: Date.now()
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
        clearInterval(chain.awaitingClientRedirectInterval);
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

    stopAwaitingClientRedirectCountdown(chain);
    updateBadgeForChain(chain);
    scheduleChainFinalization(chain);
  }, waitMs);
}

function startCleanupTimer(chain) {
  if (!chain) return;

  if (chain.cleanupTimer) {
    clearTimeout(chain.cleanupTimer);
  }

  chain.cleanupTimer = setTimeout(() => {
    cleanupChain(chain);
  }, ACTIVE_CHAIN_TIMEOUT_MS);
}

function cleanupChain(chain) {
  if (!chain) return;

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

  if (chain.cleanupTimer) {
    clearTimeout(chain.cleanupTimer);
    chain.cleanupTimer = null;
  }

  // вычищаем все подписки на целевые урлы
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

  // удаляем маппинг requestId → chain
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

  // сортируем по времени
  const sortedEventsRaw = chain.events
    .slice()
    .sort((a, b) => {
      const timeA = typeof a.timestampMs === 'number' ? a.timestampMs : Number.POSITIVE_INFINITY;
      const timeB = typeof b.timestampMs === 'number' ? b.timestampMs : Number.POSITIVE_INFINITY;
      if (timeA === timeB) return 0;
      return timeA - timeB;
    });

  // делим на шумные и нормальные
  const noisyEvents = sortedEventsRaw.filter((e) => e?.noise === true);
  const nonNoisyEvents = sortedEventsRaw.filter((e) => !e?.noise);

  const eventsForRecord = nonNoisyEvents.length > 0 ? nonNoisyEvents : sortedEventsRaw;

  const normalizedEvents = eventsForRecord.map((event) => ({
    timestamp:
      typeof event.timestampMs === 'number'
        ? formatTimestamp(event.timestampMs)
        : typeof event.timestamp === 'string'
        ? event.timestamp
        : formatTimestamp(),
    from: event.from,
    to: event.to,
    statusCode: event.statusCode,
    method: event.method,
    ip: event.ip,
    type: event.type,
    noise: event.noise === true,
    noiseReason: event.noiseReason || undefined
  }));

  const record = {
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
    events: normalizedEvents
  };

  // добавим шум отдельно
  if (noisyEvents.length > 0) {
    record.noiseEvents = noisyEvents.map((event) => ({
      timestamp:
        typeof event.timestampMs === 'number'
          ? formatTimestamp(event.timestampMs)
          : typeof event.timestamp === 'string'
          ? event.timestamp
          : formatTimestamp(),
      from: event.from,
      to: event.to,
      statusCode: event.statusCode,
      method: event.method,
      ip: event.ip,
      type: event.type,
      noise: true,
      noiseReason: event.noiseReason || undefined
    }));
  }

  // финальный URL
  record.finalUrl = resolveFinalUrl(record, details);

  // классифицируем
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

  // если всё шум — не пишем
  const allEventsNoisy =
    Array.isArray(record.events) &&
    record.events.length > 0 &&
    record.events.every((e) => e.noise === true);

  if (!allEventsNoisy) {
    await appendRedirectRecord(record);
    updateBadgeForRecord(record);
  }

  cleanupChain(chain);
}

// ===================================================================
//  attach / record / consume
// ===================================================================
function attachRequestToChain(chain, details) {
  if (!chain || !details) return chain;

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

  const rawEvent = {
    timestamp: formatTimestamp(details.timeStamp),
    timestampMs: typeof details.timeStamp === 'number' ? details.timeStamp : undefined,
    from: details.url,
    to: details.redirectUrl,
    statusCode: details.statusCode,
    method: details.method,
    ip: details.ip,
    type: details.type
  };

  // помечаем как hop (с проверкой на шум)
  const classifiedEvent = (() => {
    const e = { ...rawEvent };
    e.noise = false;
    e.noiseReason = null;
    if (e.to && isNoisyUrl(e.to)) {
      e.noise = true;
      if (e.to.includes('/cdn-cgi/')) {
        e.noiseReason = 'cloudflare-challenge';
      } else {
        e.noiseReason = 'analytics';
      }
    }
    return e;
  })();

  chain.events.push(classifiedEvent);

  updateBadgeForChain(chain);
}

async function finalizeChain(details, errorMessage) {
  const chain = getChainByRequestId(details.requestId);

  if (!chain || chain.events.length === 0) {
    if (chain) {
      cleanupChain(chain);
    }
    return;
  }

  // если ждём JS — не даём пикселю перезаписать финал
  if (
    chain.awaitingClientRedirect &&
    details &&
    details.type &&
    details.type !== 'main_frame'
  ) {
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

  const contentType = getHeaderValue(details.responseHeaders, 'content-type') || '';
  const isHtmlPage =
    typeof contentType === 'string' &&
    contentType.toLowerCase().includes('text/html') &&
    details.statusCode === 200 &&
    (details.type === 'main_frame' || details.type === 'sub_frame');

  if (canAwaitClientRedirect || isHtmlPage) {
    const awaitTimeout = isHtmlPage ? 15 * 1000 : getClientRedirectAwaitTimeout(details);
    startAwaitingClientRedirect(chain, details.url, awaitTimeout);
  } else {
    scheduleChainFinalization(chain);
  }
}

// создаём ключи для подписки на будущий URL
function createRedirectTargetKey(tabId, url) {
  if (!url) return null;
  const hasTab = typeof tabId === 'number' && tabId >= 0;
  const tabKey = `${hasTab ? tabId : 'no-tab'}::${url}`;
  const anyKey = `any-tab::${url}`;
  return { tabKey, anyKey };
}

function consumeQueueByKey(key) {
  if (!key) return null;

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

function sameHost(a, b) {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

function consumePendingRedirectTarget(details) {
  const keys = createRedirectTargetKey(details.tabId, details.url);
  if (!keys) return null;

  const { tabKey, anyKey } = keys;

  // 1. точное по табу
  let chain = consumeQueueByKey(tabKey);
  if (chain) return chain;

  // 2. общий — только если хосты совпадают
  chain = consumeQueueByKey(anyKey);
  if (chain) {
    if (chain.initialUrl && !sameHost(chain.initialUrl, details.url)) {
      return null;
    }
    return chain;
  }

  return null;
}

// ===================================================================
//  webRequest handlers
// ===================================================================
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

    // main_frame пошёл по клиентскому редиректу
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

          const rawClientEvent = {
            timestamp: formatTimestamp(details.timeStamp),
            timestampMs: typeof details.timeStamp === 'number' ? details.timeStamp : undefined,
            from: fromUrl,
            to: details.url,
            statusCode: 'JS',
            method: 'CLIENT',
            type: 'client-redirect'
          };

          const classifiedClientEvent = (() => {
            const e = { ...rawClientEvent };
            e.noise = false;
            e.noiseReason = null;
            if (e.to && isNoisyUrl(e.to)) {
              e.noise = true;
              e.noiseReason = 'analytics';
            }
            return e;
          })();

          candidate.events.push(classifiedClientEvent);

          candidate.pendingFinalDetails = null;
          cancelAwaitingClientRedirect(candidate);
          updateBadgeForChain(candidate);
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

  // подчистим все очереди, завязанные на этот таб
  for (const [key, queue] of pendingRedirectTargets.entries()) {
    if (key.startsWith(`${tabId}::`)) {
      pendingRedirectTargets.delete(key);
      continue;
    }
    const filtered = queue.filter((chainId) => {
      const c = chainsById.get(chainId);
      return c && c.tabId !== tabId;
    });
    if (filtered.length === 0) {
      pendingRedirectTargets.delete(key);
    } else {
      pendingRedirectTargets.set(key, filtered);
    }
  }

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

// ===================================================================
//  EVENT REGISTRATION
// ===================================================================
try {
  if (chrome?.webRequest?.onBeforeRequest) {
    chrome.webRequest.onBeforeRequest.addListener(handleBeforeRequest, WEB_REQUEST_FILTER);
  }

  if (chrome?.webRequest?.onBeforeRedirect) {
    chrome.webRequest.onBeforeRedirect.addListener(
      handleBeforeRedirect,
      WEB_REQUEST_FILTER,
      WEB_REQUEST_EXTRA_INFO_SPEC
    );
  }

  if (chrome?.webRequest?.onCompleted) {
    chrome.webRequest.onCompleted.addListener(
      handleRequestCompleted,
      WEB_REQUEST_FILTER,
      WEB_REQUEST_EXTRA_INFO_SPEC
    );
  }

  if (chrome?.webRequest?.onErrorOccurred) {
    chrome.webRequest.onErrorOccurred.addListener(handleRequestError, WEB_REQUEST_FILTER);
  }
} catch (error) {
  console.error('Failed to register webRequest listeners', error);
}

if (chrome?.webNavigation?.onCommitted) {
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (typeof details.tabId !== 'number' || details.tabId < 0) {
      return;
    }

    tabLastCommittedUrl.set(details.tabId, details.url);

    if (details.frameId === 0) {
      const pending = pendingClientRedirects.get(details.tabId);
      if (pending) {
        const chain = chainsById.get(pending.chainId);
        if (chain && chain.awaitingClientRedirect) {
          const lastNonNoisy = [...chain.events].reverse().find((e) => !e.noise && e.to);
          const lastTarget = lastNonNoisy?.to || chain.events.at(-1)?.to;

          let isBackwardHop = false;
          if (lastTarget && details.url) {
            try {
              const a = new URL(lastTarget);
              const b = new URL(details.url);
              isBackwardHop = a.hostname === b.hostname && a.pathname === b.pathname;
            } catch {}
          }

          if (!isBackwardHop) {
            const clientHop = {
              timestamp: formatTimestamp(details.timeStamp),
              timestampMs: typeof details.timeStamp === 'number' ? details.timeStamp : undefined,
              from:
                pending.fromUrl ||
                chain.pendingFinalDetails?.details?.url ||
                chain.events.at(-1)?.to ||
                chain.initialUrl,
              to: details.url,
              statusCode: 'JS',
              method: 'CLIENT',
              type: 'client-redirect',
              noise: false,
              noiseReason: null
            };

            if (clientHop.to && isNoisyUrl(clientHop.to)) {
              clientHop.noise = true;
              clientHop.noiseReason = 'analytics';
            }

            chain.events.push(clientHop);
          }

          cancelAwaitingClientRedirect(chain);
          chain.pendingFinalDetails = {
            details: {
              requestId: chain.id,
              tabId: details.tabId,
              url: details.url,
              type: 'main_frame',
              statusCode: 200,
              timeStamp: details.timeStamp || Date.now(),
              responseHeaders: []
            },
            errorMessage: null
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
  });
}

if (chrome?.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    cleanupTabState(tabId);
  });
}

// ===================================================================
//  RUNTIME MESSAGES (popup <-> background)
// ===================================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message && message.type;

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

    return true;
  }

  if (type === 'redirect-inspector:clear-log' || type === 'redirect-inspector:clear-redirects') {
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

  sendResponse({ ok: false, error: 'Unknown message type' });
  return false;
});
