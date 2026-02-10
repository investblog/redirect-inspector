import { describe, expect, it } from 'vitest';
import {
  formatBadgeText,
  formatTimestamp,
  hasExtension,
  hasMediaExtension,
  hasPixelExtension,
  hasTrackingKeyword,
  isLikelyBrowserUrl,
  isMediaContentType,
  isNoisyUrl,
  normalizeForComparison,
  parseContentLength,
  sameHost,
} from './helpers';

describe('isNoisyUrl', () => {
  it('returns false for undefined/empty', () => {
    expect(isNoisyUrl(undefined)).toBe(false);
    expect(isNoisyUrl('')).toBe(false);
  });

  it('detects Cloudflare challenge URLs', () => {
    expect(isNoisyUrl('https://example.com/cdn-cgi/challenge-platform/foo')).toBe(true);
    expect(isNoisyUrl('https://example.com/cdn-cgi/trace')).toBe(true);
    expect(isNoisyUrl('https://example.com/cdn-cgi/zaraz/t')).toBe(true);
    expect(isNoisyUrl('https://challenges.cloudflare.com/turnstile/v0/api.js')).toBe(true);
  });

  it('detects analytics host suffixes', () => {
    expect(isNoisyUrl('https://www.googletagmanager.com/gtm.js')).toBe(true);
    expect(isNoisyUrl('https://www.google-analytics.com/collect')).toBe(true);
    expect(isNoisyUrl('https://connect.facebook.net/sdk.js')).toBe(true);
  });

  it('returns false for normal URLs', () => {
    expect(isNoisyUrl('https://example.com/page')).toBe(false);
    expect(isNoisyUrl('https://cdn.example.com/style.css')).toBe(false);
  });

  it('returns false for invalid URLs', () => {
    expect(isNoisyUrl('not-a-url')).toBe(false);
  });
});

describe('parseContentLength', () => {
  it('parses valid numbers', () => {
    expect(parseContentLength('0')).toBe(0);
    expect(parseContentLength('1024')).toBe(1024);
    expect(parseContentLength('999999')).toBe(999999);
  });

  it('returns null for invalid values', () => {
    expect(parseContentLength(undefined)).toBeNull();
    expect(parseContentLength('')).toBeNull();
    expect(parseContentLength('abc')).toBeNull();
    expect(parseContentLength('-1')).toBeNull();
  });
});

describe('hasTrackingKeyword', () => {
  it('detects tracking keywords', () => {
    expect(hasTrackingKeyword('https://example.com/pixel.gif')).toBe(true);
    expect(hasTrackingKeyword('https://example.com/track?id=1')).toBe(true);
    expect(hasTrackingKeyword('https://example.com/analytics/collect')).toBe(true);
  });

  it('returns false for normal URLs', () => {
    expect(hasTrackingKeyword('https://example.com/page')).toBe(false);
    expect(hasTrackingKeyword(undefined)).toBe(false);
  });
});

describe('hasPixelExtension', () => {
  it('detects pixel file extensions', () => {
    expect(hasPixelExtension('https://example.com/p.gif')).toBe(true);
    expect(hasPixelExtension('https://example.com/t.png')).toBe(true);
    expect(hasPixelExtension('https://example.com/i.svg')).toBe(true);
  });

  it('returns false for non-pixel extensions', () => {
    expect(hasPixelExtension('https://example.com/page.html')).toBe(false);
    expect(hasPixelExtension('https://example.com/script.js')).toBe(false);
  });
});

describe('hasMediaExtension', () => {
  it('detects media file extensions', () => {
    expect(hasMediaExtension('https://example.com/video.mp4')).toBe(true);
    expect(hasMediaExtension('https://example.com/audio.mp3')).toBe(true);
    expect(hasMediaExtension('https://example.com/stream.m3u8')).toBe(true);
  });

  it('returns false for non-media extensions', () => {
    expect(hasMediaExtension('https://example.com/page.html')).toBe(false);
  });
});

describe('hasExtension', () => {
  it('falls back to simple string match on invalid URL', () => {
    expect(hasExtension('not-a-url.gif', ['.gif'])).toBe(true);
    expect(hasExtension('not-a-url.html', ['.gif'])).toBe(false);
  });
});

describe('isMediaContentType', () => {
  it('detects video/audio content types', () => {
    expect(isMediaContentType('video/mp4')).toBe(true);
    expect(isMediaContentType('audio/mpeg')).toBe(true);
    expect(isMediaContentType('application/vnd.apple.mpegurl')).toBe(true);
    expect(isMediaContentType('application/dash+xml')).toBe(true);
  });

  it('returns false for non-media types', () => {
    expect(isMediaContentType('text/html')).toBe(false);
    expect(isMediaContentType('application/json')).toBe(false);
    expect(isMediaContentType(undefined)).toBe(false);
  });
});

describe('formatBadgeText', () => {
  it('returns empty string for zero/negative/NaN', () => {
    expect(formatBadgeText(0)).toBe('');
    expect(formatBadgeText(-1)).toBe('');
    expect(formatBadgeText(Number.NaN)).toBe('');
  });

  it('returns count as string', () => {
    expect(formatBadgeText(1)).toBe('1');
    expect(formatBadgeText(42)).toBe('42');
    expect(formatBadgeText(99)).toBe('99');
  });

  it('caps at 99+', () => {
    expect(formatBadgeText(100)).toBe('99+');
    expect(formatBadgeText(999)).toBe('99+');
  });
});

describe('isLikelyBrowserUrl', () => {
  it('returns true for http/https URLs', () => {
    expect(isLikelyBrowserUrl('https://example.com/page')).toBe(true);
    expect(isLikelyBrowserUrl('http://example.com')).toBe(true);
  });

  it('returns false for non-navigable URLs', () => {
    expect(isLikelyBrowserUrl('https://example.com/bundle.js')).toBe(false);
    expect(isLikelyBrowserUrl('https://example.com/module.mjs')).toBe(false);
  });

  it('returns false for non-http protocols', () => {
    expect(isLikelyBrowserUrl('ftp://example.com')).toBe(false);
    expect(isLikelyBrowserUrl('chrome://settings')).toBe(false);
  });

  it('returns false for empty/invalid', () => {
    expect(isLikelyBrowserUrl(undefined)).toBe(false);
    expect(isLikelyBrowserUrl('')).toBe(false);
    expect(isLikelyBrowserUrl('not-a-url')).toBe(false);
  });
});

describe('formatTimestamp', () => {
  it('returns ISO string for a number', () => {
    const ts = formatTimestamp(1700000000000);
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(ts).toContain('2023');
  });

  it('returns current ISO string when no argument', () => {
    const ts = formatTimestamp();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('normalizeForComparison', () => {
  it('converts null/undefined to empty string', () => {
    expect(normalizeForComparison(null)).toBe('');
    expect(normalizeForComparison(undefined)).toBe('');
  });

  it('converts values to string', () => {
    expect(normalizeForComparison(301)).toBe('301');
    expect(normalizeForComparison('hello')).toBe('hello');
  });
});

describe('sameHost', () => {
  it('returns true for same host', () => {
    expect(sameHost('https://example.com/a', 'https://example.com/b')).toBe(true);
  });

  it('returns false for different hosts', () => {
    expect(sameHost('https://a.com', 'https://b.com')).toBe(false);
  });

  it('returns false for invalid URLs', () => {
    expect(sameHost('not-url', 'also-not')).toBe(false);
  });
});
