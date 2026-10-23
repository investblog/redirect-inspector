// Constants
export const REDIRECT_LOG_KEY = 'redirectLog';
export const MAX_RECORDS = 50;
export const ACTIVE_CHAIN_TIMEOUT_MS = 5 * 60 * 1000;

export const CLIENT_REDIRECT_DEFAULT_AWAIT_MS = 3 * 1000;
export const CLIENT_REDIRECT_EXTENDED_AWAIT_MS = 5 * 1000;

export const CHAIN_FINALIZATION_DELAY_MS = 250;

/** Client-side landing: max wait for the first change after the final page loads; also the hard cap. */
export const LANDING_WINDOW_MS = 10 * 1000;
/** The window settles after this long without another change. */
export const LANDING_QUIET_MS = 1000;
/** Manual checks wait less for a first change — the probe tab stays open that long. */
export const PROBE_LANDING_WAIT_MS = 2 * 1000;

export const TRACKING_KEYWORDS = [
  'pixel',
  'track',
  'collect',
  'analytics',
  'impression',
  'beacon',
  'measure',
  'telemetry',
  'conversion',
  'retarget',
  'syndication',
];
export const PIXEL_EXTENSIONS = ['.gif', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.svg'];
export const MEDIA_EXTENSIONS = [
  '.mp4',
  '.webm',
  '.mkv',
  '.mov',
  '.m4v',
  '.m4a',
  '.mp3',
  '.aac',
  '.ogg',
  '.oga',
  '.ogv',
  '.wav',
  '.flac',
  '.m3u8',
  '.mpd',
  '.ts',
  '.m2ts',
];
export const MEDIA_CONTENT_TYPE_PREFIXES = ['video/', 'audio/'];
export const MEDIA_CONTENT_TYPE_INCLUDES = [
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'application/dash+xml',
];

export const CLIENT_REDIRECT_AWAIT_TYPES = new Set(['main_frame', 'sub_frame']);

export const WEB_REQUEST_FILTER: chrome.webRequest.RequestFilter = { urls: ['<all_urls>'] };
export const WEB_REQUEST_EXTRA_INFO_SPEC: string[] = ['responseHeaders'];

export const NON_NAVIGABLE_EXTENSIONS = ['.js', '.mjs'];
export const LIKELY_BROWSER_PROTOCOLS = new Set(['http:', 'https:']);

export const NOISY_URL_PATTERNS = [
  '/cdn-cgi/challenge-platform/',
  '/cdn-cgi/challenge/',
  '/cdn-cgi/bm/',
  '/cdn-cgi/trace',
  '/cdn-cgi/zaraz/',
  '/cdn-cgi/scripts/',
  '/pagead/',
  '/ads/ga-audiences',
  '/ads/system/',
  '/_vercel/insights',
];

export const NOISY_HOST_SUFFIXES = [
  // Cloudflare
  'challenges.cloudflare.com',
  // Google
  'googletagmanager.com',
  'google-analytics.com',
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  // Microsoft
  'bat.bing.com',
  'clarity.ms',
  // Yandex / RU
  'mc.yandex.ru',
  'mc.yandex.com',
  'an.yandex.ru',
  'yastatic.net',
  'adfox.ru',
  'top-fwz1.mail.ru',
  'top.mail.ru',
  'ad.mail.ru',
  'ads.vk.com',
  'mradx.net',
  'adriver.ru',
  // Social pixels
  'connect.facebook.net',
  'facebook.com',
  'tiktok.com',
  'ads.linkedin.com',
  'snap.licdn.com',
  'ct.pinterest.com',
  'analytics.twitter.com',
  'pixel.wp.com',
  // Ad networks
  'criteo.com',
  'criteo.net',
  'adnxs.com',
  'amazon-adsystem.com',
  'taboola.com',
  'outbrain.com',
  // UX analytics
  'hotjar.com',
  'mouseflow.com',
  'fullstory.com',
  // Measurement
  'analytics.yahoo.com',
  'scorecardresearch.com',
  'quantserve.com',
  'nr-data.net',
  'radar.cedexis.com',
  // Consent
  'cdn.cookielaw.org',
  'consent.cookiebot.com',
];

// Helper functions

export function isNoisyUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (NOISY_URL_PATTERNS.some((p) => u.pathname.includes(p))) {
      return true;
    }
    if (NOISY_HOST_SUFFIXES.some((host) => u.hostname === host || u.hostname.endsWith(`.${host}`))) {
      return true;
    }
  } catch {
    // ignore parse error
  }
  return false;
}

export function getHeaderValue(
  headers: chrome.webRequest.HttpHeader[] | undefined,
  headerName: string,
): string | undefined {
  if (!Array.isArray(headers) || !headerName) {
    return undefined;
  }

  const target = headerName.toLowerCase();
  const match = headers.find((header) => header?.name?.toLowerCase() === target);
  return match?.value;
}

export function parseContentLength(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function hasTrackingKeyword(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  const lowerUrl = url.toLowerCase();
  return TRACKING_KEYWORDS.some((keyword) => lowerUrl.includes(keyword));
}

export function hasExtension(url: string | undefined, extensions: string[]): boolean {
  if (!url) {
    return false;
  }

  try {
    const lowerPath = new URL(url).pathname.toLowerCase();
    return extensions.some((extension) => lowerPath.endsWith(extension));
  } catch {
    const lowerUrl = url.toLowerCase();
    return extensions.some((extension) => lowerUrl.includes(extension));
  }
}

export function hasPixelExtension(url: string | undefined): boolean {
  return hasExtension(url, PIXEL_EXTENSIONS);
}

export function hasMediaExtension(url: string | undefined): boolean {
  return hasExtension(url, MEDIA_EXTENSIONS);
}

export function isMediaContentType(contentType: string | undefined): boolean {
  if (typeof contentType !== 'string') {
    return false;
  }

  const lower = contentType.toLowerCase();
  if (MEDIA_CONTENT_TYPE_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return true;
  }

  return MEDIA_CONTENT_TYPE_INCLUDES.some((needle) => lower.includes(needle));
}

export function formatBadgeText(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return '';
  }

  if (count > BADGE_MAX_COUNT) {
    return `${BADGE_MAX_COUNT}+`;
  }

  return String(count);
}

export const BADGE_MAX_COUNT = 99;
export const BADGE_COLOR = '#2563eb';
export const BADGE_COUNTDOWN_COLOR = '#dc2626';
export const BADGE_SUCCESS_COLOR = '#16a34a';
export const BADGE_COUNTDOWN_TICK_MS = 1000;

export function handleChromePromise(promise: Promise<unknown> | undefined, context?: string): void {
  if (!promise || typeof (promise as Promise<unknown>).catch !== 'function') {
    return;
  }

  promise.catch((error: Error) => {
    if (error?.message?.includes('No tab with id')) {
      return;
    }

    if (context) {
      console.error(context, error);
    } else {
      console.error('Chrome API call failed', error);
    }
  });
}

export function isLikelyBrowserUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const pathname = (parsed.pathname || '').toLowerCase();

    if (!LIKELY_BROWSER_PROTOCOLS.has(parsed.protocol)) {
      return false;
    }

    if (NON_NAVIGABLE_EXTENSIONS.some((extension) => pathname.endsWith(extension))) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function formatTimestamp(timestampMs?: number): string {
  if (typeof timestampMs === 'number') {
    return new Date(timestampMs).toISOString();
  }

  return new Date().toISOString();
}

export function normalizeForComparison(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value);
}

export function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

// ---- Sensitive URL parts ----

// Parameter names (lowercased, '-' -> '_') whose values are credentials. Exact
// matches only, plus the *_token / *_secret suffixes — a broad substring rule
// would mask harmless names like "authority" or "session_length".
const SENSITIVE_PARAM_NAMES = new Set([
  'token',
  'code',
  'jwt',
  'key',
  'apikey',
  'api_key',
  'secret',
  'password',
  'passwd',
  'pwd',
  'ticket',
  'credential',
  'credentials',
  'assertion',
  'samlresponse',
  'samlrequest',
  'session_id',
  'sessionid',
  'sid',
  'auth',
  'authorization',
]);

const REDACTED = '***';

function isSensitiveParamName(rawName: string): boolean {
  let name = rawName;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    // keep the raw spelling
  }
  name = name.trim().toLowerCase().replace(/-/g, '_');
  return SENSITIVE_PARAM_NAMES.has(name) || name.endsWith('_token') || name.endsWith('_secret');
}

/** Mask values of sensitive `k=v` pairs; untouched pairs keep their exact spelling. */
function maskParams(params: string): string {
  return params
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq <= 0 || eq === pair.length - 1) return pair;
      return isSensitiveParamName(pair.slice(0, eq)) ? `${pair.slice(0, eq + 1)}${REDACTED}` : pair;
    })
    .join('&');
}

// A bare fragment that looks like a credential: a JWT, or a long opaque run of
// letters and digits (no '/', so hash routes are left alone).
const JWT_RE = /^eyJ[\w-]*\.[\w-]*\.[\w-]*$/;
const OPAQUE_TOKEN_RE = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_]{32,}$/;
// base64url may contain '-': accept it only in mixed case with digits — slugs
// ("chapter-12-introduction-…") are lowercase.
const BASE64URL_TOKEN_RE = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])[A-Za-z0-9_-]{32,}$/;

function maskFragment(fragment: string): string {
  const q = fragment.indexOf('?');
  if (q >= 0) return `${fragment.slice(0, q + 1)}${maskParams(fragment.slice(q + 1))}`;
  if (fragment.includes('=')) return maskParams(fragment);
  return JWT_RE.test(fragment) || OPAQUE_TOKEN_RE.test(fragment) || BASE64URL_TOKEN_RE.test(fragment)
    ? REDACTED
    : fragment;
}

/**
 * Mask credentials in a URL before it is persisted: values of sensitive query
 * and fragment parameters, bare token fragments, and `user:pass@`. Works on the
 * raw string, so a URL with nothing to mask comes back byte for byte. Returns
 * null for an unparsable URL — fail closed, the caller must not store it.
 */
export function maskSensitiveUrl(url: string): { url: string; redacted: boolean } | null {
  try {
    new URL(url);
  } catch {
    return null;
  }

  let rest = url;
  let fragment: string | null = null;
  const hash = rest.indexOf('#');
  if (hash >= 0) {
    fragment = rest.slice(hash + 1);
    rest = rest.slice(0, hash);
  }

  let query: string | null = null;
  const q = rest.indexOf('?');
  if (q >= 0) {
    query = rest.slice(q + 1);
    rest = rest.slice(0, q);
  }

  const withoutUserInfo = rest.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#@]*@/i, '$1');

  const masked =
    withoutUserInfo +
    (query === null ? '' : `?${maskParams(query)}`) +
    (fragment === null ? '' : `#${maskFragment(fragment)}`);

  return { url: masked, redacted: masked !== url };
}
