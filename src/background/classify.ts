import type {
  ChainCompletionDetails,
  ClassificationResult,
  PreparedEvents,
  RedirectEvent,
  RedirectRecord,
} from '../shared/types/redirect';
import {
  formatTimestamp,
  getHeaderValue,
  hasMediaExtension,
  hasPixelExtension,
  hasTrackingKeyword,
  isLikelyBrowserUrl,
  isMediaContentType,
  isNoisyUrl,
  normalizeForComparison,
  parseContentLength,
} from './helpers';

export function classifyEventLikeHop(event: RedirectEvent): RedirectEvent {
  const e: RedirectEvent = { ...event };
  e.noise = false;
  e.noiseReason = null;

  if (e.to && isNoisyUrl(e.to)) {
    e.noise = true;
    if (e.to.includes('/cdn-cgi/') || e.to.includes('challenges.cloudflare.com')) {
      e.noiseReason = 'cloudflare-challenge';
    } else {
      e.noiseReason = 'analytics';
    }
  }

  return e;
}

export function eventsDescribeSameHop(a: RedirectEvent | undefined, b: RedirectEvent | undefined): boolean {
  if (!a || !b) {
    return false;
  }

  return (
    normalizeForComparison(a.from) === normalizeForComparison(b.from) &&
    normalizeForComparison(a.to) === normalizeForComparison(b.to) &&
    normalizeForComparison(a.statusCode) === normalizeForComparison(b.statusCode) &&
    normalizeForComparison(a.method) === normalizeForComparison(b.method) &&
    normalizeForComparison(a.type) === normalizeForComparison(b.type)
  );
}

export function mergeEventDetails(target: RedirectEvent, update: RedirectEvent): RedirectEvent {
  const merged: RedirectEvent = { ...target };
  const fields = ['timestamp', 'timestampMs', 'from', 'to', 'statusCode', 'method', 'ip', 'type'] as const;

  for (const field of fields) {
    if ((update as unknown as Record<string, unknown>)[field] !== undefined) {
      (merged as unknown as Record<string, unknown>)[field] = (update as unknown as Record<string, unknown>)[field];
    }
  }

  if (update.noise !== undefined) {
    merged.noise = update.noise;
  }
  if (update.noiseReason !== undefined) {
    merged.noiseReason = update.noiseReason;
  }

  return merged;
}

export function normalizeEventForRecord(event: RedirectEvent | null): RedirectEvent | null {
  if (!event) {
    return null;
  }

  let timestamp: string;
  if (typeof event.timestampMs === 'number') {
    timestamp = formatTimestamp(event.timestampMs);
  } else if (typeof event.timestamp === 'string') {
    timestamp = event.timestamp;
  } else {
    timestamp = formatTimestamp();
  }

  return {
    timestamp,
    from: event.from,
    to: event.to,
    statusCode: event.statusCode,
    method: event.method,
    ip: event.ip,
    type: event.type,
    noise: event.noise === true,
    noiseReason: event.noiseReason || undefined,
  };
}

export function prepareEventsForRecord(events: RedirectEvent[]): PreparedEvents {
  const safeEvents = Array.isArray(events) ? events.slice() : [];

  const sortedEvents = safeEvents.sort((a, b) => {
    const timeA = typeof a?.timestampMs === 'number' ? a.timestampMs : Number.POSITIVE_INFINITY;
    const timeB = typeof b?.timestampMs === 'number' ? b.timestampMs : Number.POSITIVE_INFINITY;
    if (timeA === timeB) {
      return 0;
    }
    return timeA - timeB;
  });

  const noisyEvents: RedirectEvent[] = [];
  const nonNoisyEvents: RedirectEvent[] = [];

  for (const event of sortedEvents) {
    if (event?.noise) {
      noisyEvents.push(event);
    } else {
      nonNoisyEvents.push(event);
    }
  }

  const eventsForRecord = nonNoisyEvents.length > 0 ? nonNoisyEvents : sortedEvents;

  const normalizedEvents = eventsForRecord
    .map((event) => normalizeEventForRecord(event))
    .filter((e): e is RedirectEvent => e !== null);
  const normalizedNoiseEvents = noisyEvents
    .map((event) => normalizeEventForRecord(event))
    .filter((e): e is RedirectEvent => e !== null);

  return {
    normalizedEvents,
    normalizedNoiseEvents,
    allEventsNoisy: normalizedEvents.length > 0 && normalizedEvents.every((event) => event.noise === true),
    firstEvent: eventsForRecord[0] || null,
    lastEvent: eventsForRecord.at(-1) || null,
  };
}

export function resolveFinalUrl(
  record: RedirectRecord,
  completionDetails: ChainCompletionDetails,
  tabLastCommittedUrl: Map<number, string>,
): string | null {
  const completionType = completionDetails?.type;
  const completionUrl = completionDetails?.url;

  const candidates: string[] = [];

  const isNavigationCompletion = completionType === 'main_frame' || completionType === 'sub_frame';

  if (isNavigationCompletion && completionUrl) {
    candidates.push(completionUrl);
  }

  if (Array.isArray(record.events) && record.events.length > 0) {
    const navigationalEvent = [...record.events]
      .reverse()
      .find(
        (event) =>
          event?.to && (event.type === 'client-redirect' || event.type === 'main_frame' || event.method === 'CLIENT'),
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

  const uniqueCandidates = candidates.filter(
    (candidate, index) => candidate && candidates.indexOf(candidate) === index,
  );

  const preferred = uniqueCandidates.find((candidate) => isLikelyBrowserUrl(candidate) && !isNoisyUrl(candidate));
  if (preferred) {
    return preferred;
  }

  const fallbackBrowser = uniqueCandidates.find((candidate) => isLikelyBrowserUrl(candidate));
  if (fallbackBrowser) {
    return fallbackBrowser;
  }

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

export function classifyRecord(
  record: RedirectRecord,
  completionDetails: ChainCompletionDetails = {},
): ClassificationResult {
  const events = Array.isArray(record.events) ? record.events : [];
  const finalUrl = record.finalUrl || '';

  const contentTypeHeader = getHeaderValue(completionDetails.responseHeaders, 'content-type');
  const contentType = typeof contentTypeHeader === 'string' ? contentTypeHeader : undefined;
  const normalizedContentType = typeof contentTypeHeader === 'string' ? contentTypeHeader.toLowerCase() : '';
  const contentLength = parseContentLength(getHeaderValue(completionDetails.responseHeaders, 'content-length'));

  const mediaReasons: string[] = [];

  if (events.some((event) => event?.type === 'media')) {
    mediaReasons.push('media request in chain');
  }

  if (typeof completionDetails.type === 'string' && completionDetails.type.toLowerCase() === 'media') {
    mediaReasons.push('final resource is media');
  }

  if (hasMediaExtension(finalUrl)) {
    mediaReasons.push('media file extension');
  }

  if (isMediaContentType(normalizedContentType)) {
    mediaReasons.push('media content-type');
  }

  if (mediaReasons.length > 0) {
    return {
      classification: 'likely-media',
      classificationReason: mediaReasons.join('; '),
      contentType,
      contentLength,
    };
  }

  const heuristics: string[] = [];

  if (events.length <= 1) {
    heuristics.push('single hop chain');
  }

  if (events.length > 0 && events.every((event) => event?.type === 'image')) {
    heuristics.push('all hops are image requests');
  }

  if (hasPixelExtension(finalUrl)) {
    heuristics.push('image file extension');
  }

  if (hasTrackingKeyword(finalUrl)) {
    heuristics.push('tracking keyword in URL');
  }

  if (isNoisyUrl(finalUrl)) {
    heuristics.push('noisy url (cf/analytics)');
  }

  if (completionDetails.type === 'image') {
    heuristics.push('final resource is an image');
  }

  if (normalizedContentType.includes('image/')) {
    heuristics.push('image content-type');
  }

  if (typeof contentLength === 'number' && contentLength <= 2048) {
    heuristics.push('tiny response size');
  }

  const classification = heuristics.length >= 2 ? ('likely-tracking' as const) : ('normal' as const);

  return {
    classification,
    classificationReason: classification === 'likely-tracking' ? heuristics.join('; ') : undefined,
    contentType,
    contentLength,
  };
}
