import { describe, expect, it } from 'vitest';
import type { RedirectEvent, RedirectRecord } from '../shared/types/redirect';
import {
  classifyEventLikeHop,
  classifyRecord,
  eventsDescribeSameHop,
  mergeEventDetails,
  normalizeEventForRecord,
  prepareEventsForRecord,
} from './classify';

function makeEvent(overrides: Partial<RedirectEvent> = {}): RedirectEvent {
  return {
    timestamp: '2024-01-01T00:00:00.000Z',
    from: 'https://a.com',
    to: 'https://b.com',
    statusCode: 301,
    method: 'GET',
    type: 'main_frame',
    ...overrides,
  };
}

function makeRecord(overrides: Partial<RedirectRecord> = {}): RedirectRecord {
  return {
    id: 'test-id',
    tabId: 1,
    initiatedAt: '2024-01-01T00:00:00.000Z',
    events: [],
    ...overrides,
  };
}

describe('classifyEventLikeHop', () => {
  it('marks normal events as non-noise', () => {
    const event = makeEvent({ to: 'https://example.com/page' });
    const result = classifyEventLikeHop(event);
    expect(result.noise).toBe(false);
    expect(result.noiseReason).toBeNull();
  });

  it('marks Cloudflare cdn-cgi challenge as noise', () => {
    const event = makeEvent({ to: 'https://example.com/cdn-cgi/challenge-platform/foo' });
    const result = classifyEventLikeHop(event);
    expect(result.noise).toBe(true);
    expect(result.noiseReason).toBe('cloudflare-challenge');
  });

  it('marks Cloudflare Turnstile challenge as noise', () => {
    const event = makeEvent({ to: 'https://challenges.cloudflare.com/turnstile/v0/api.js' });
    const result = classifyEventLikeHop(event);
    expect(result.noise).toBe(true);
    expect(result.noiseReason).toBe('cloudflare-challenge');
  });

  it('marks analytics hosts as noise', () => {
    const event = makeEvent({ to: 'https://www.google-analytics.com/collect' });
    const result = classifyEventLikeHop(event);
    expect(result.noise).toBe(true);
    expect(result.noiseReason).toBe('analytics');
  });

  it('does not mutate original event', () => {
    const event = makeEvent({ to: 'https://www.google-analytics.com/collect' });
    const result = classifyEventLikeHop(event);
    expect(event.noise).toBeUndefined();
    expect(result.noise).toBe(true);
  });
});

describe('eventsDescribeSameHop', () => {
  it('returns true for identical events', () => {
    const a = makeEvent();
    const b = makeEvent();
    expect(eventsDescribeSameHop(a, b)).toBe(true);
  });

  it('returns false when fields differ', () => {
    const a = makeEvent({ statusCode: 301 });
    const b = makeEvent({ statusCode: 302 });
    expect(eventsDescribeSameHop(a, b)).toBe(false);
  });

  it('returns false for undefined inputs', () => {
    expect(eventsDescribeSameHop(undefined, makeEvent())).toBe(false);
    expect(eventsDescribeSameHop(makeEvent(), undefined)).toBe(false);
  });
});

describe('mergeEventDetails', () => {
  it('overwrites fields from update', () => {
    const target = makeEvent({ ip: '1.1.1.1' });
    const update = makeEvent({ ip: '2.2.2.2' });
    const merged = mergeEventDetails(target, update);
    expect(merged.ip).toBe('2.2.2.2');
  });

  it('preserves fields not in update', () => {
    const target = makeEvent({ ip: '1.1.1.1' });
    const update = makeEvent({ ip: undefined });
    const merged = mergeEventDetails(target, update);
    expect(merged.ip).toBe('1.1.1.1');
  });

  it('merges noise fields', () => {
    const target = makeEvent();
    const update = makeEvent({ noise: true, noiseReason: 'analytics' });
    const merged = mergeEventDetails(target, update);
    expect(merged.noise).toBe(true);
    expect(merged.noiseReason).toBe('analytics');
  });
});

describe('normalizeEventForRecord', () => {
  it('returns null for null input', () => {
    expect(normalizeEventForRecord(null)).toBeNull();
  });

  it('normalizes event fields', () => {
    const event = makeEvent({ timestampMs: 1700000000000, noise: false });
    const result = normalizeEventForRecord(event)!;
    expect(result.timestamp).toMatch(/2023/);
    expect(result.noise).toBe(false);
    expect(result.noiseReason).toBeUndefined();
  });

  it('uses timestamp string when no timestampMs', () => {
    const event = makeEvent({ timestampMs: undefined, timestamp: '2024-06-01T00:00:00Z' });
    const result = normalizeEventForRecord(event)!;
    expect(result.timestamp).toBe('2024-06-01T00:00:00Z');
  });
});

describe('prepareEventsForRecord', () => {
  it('separates noise and non-noise events', () => {
    const events = [
      makeEvent({ noise: false, timestampMs: 1 }),
      makeEvent({ noise: true, noiseReason: 'analytics', timestampMs: 2 }),
      makeEvent({ noise: false, timestampMs: 3 }),
    ];
    const result = prepareEventsForRecord(events);
    expect(result.normalizedEvents).toHaveLength(2);
    expect(result.normalizedNoiseEvents).toHaveLength(1);
    expect(result.allEventsNoisy).toBe(false);
  });

  it('uses all events when all are noisy', () => {
    const events = [
      makeEvent({ noise: true, noiseReason: 'analytics', timestampMs: 1 }),
      makeEvent({ noise: true, noiseReason: 'cloudflare-challenge', timestampMs: 2 }),
    ];
    const result = prepareEventsForRecord(events);
    // When all are noisy, normalizedEvents gets the full list (sorted)
    expect(result.normalizedEvents).toHaveLength(2);
    expect(result.allEventsNoisy).toBe(true);
  });

  it('sorts by timestampMs', () => {
    const events = [
      makeEvent({ timestampMs: 3, from: 'https://c.com' }),
      makeEvent({ timestampMs: 1, from: 'https://a.com' }),
    ];
    const result = prepareEventsForRecord(events);
    expect(result.normalizedEvents[0].from).toBe('https://a.com');
  });

  it('handles empty array', () => {
    const result = prepareEventsForRecord([]);
    expect(result.normalizedEvents).toHaveLength(0);
    expect(result.normalizedNoiseEvents).toHaveLength(0);
    expect(result.firstEvent).toBeNull();
    expect(result.lastEvent).toBeNull();
  });
});

describe('classifyRecord', () => {
  it('classifies normal chains', () => {
    const record = makeRecord({
      events: [makeEvent(), makeEvent({ statusCode: 302, from: 'https://b.com', to: 'https://c.com' })],
      finalUrl: 'https://c.com/page',
    });
    const result = classifyRecord(record);
    expect(result.classification).toBe('normal');
  });

  it('classifies likely-tracking when multiple heuristics match', () => {
    const record = makeRecord({
      events: [makeEvent({ type: 'image' })],
      finalUrl: 'https://example.com/pixel.gif?track=1',
    });
    const result = classifyRecord(record);
    expect(result.classification).toBe('likely-tracking');
    expect(result.classificationReason).toBeDefined();
  });

  it('classifies likely-media for media content types', () => {
    const record = makeRecord({
      events: [makeEvent({ type: 'media' })],
      finalUrl: 'https://example.com/video.mp4',
    });
    const result = classifyRecord(record);
    expect(result.classification).toBe('likely-media');
  });

  it('handles empty events array', () => {
    const record = makeRecord({ events: [], finalUrl: 'https://example.com' });
    const result = classifyRecord(record);
    expect(result.classification).toBe('normal');
  });
});
