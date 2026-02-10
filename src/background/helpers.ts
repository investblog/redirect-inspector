// Constants
export const REDIRECT_LOG_KEY = 'redirectLog';
export const MAX_RECORDS = 50;
export const ACTIVE_CHAIN_TIMEOUT_MS = 5 * 60 * 1000;

export const CLIENT_REDIRECT_DEFAULT_AWAIT_MS = 10 * 1000;
export const CLIENT_REDIRECT_EXTENDED_AWAIT_MS = 15 * 1000;

export const CHAIN_FINALIZATION_DELAY_MS = 250;

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
  'adfox.ru',
  'top-fwz1.mail.ru',
  'top.mail.ru',
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
