import type { RedirectEvent, RedirectRecord } from '../types/redirect';
import type { AnalysisIssue, AnalysisResult, HopAnnotation, Severity } from './types';

// ---- Helpers ----

function getHost(url: string | undefined): string {
  try {
    return new URL(url!).host;
  } catch {
    return '';
  }
}

const SEVERITY_ORDER: Record<string, number> = { error: 0, warning: 1, info: 2 };

function sortBySeverity(issues: AnalysisIssue[]): AnalysisIssue[] {
  return issues.slice().sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
}

// ---- 1. Chain length ----

function checkChainLength(_record: RedirectRecord, events: RedirectEvent[]): AnalysisIssue[] {
  const len = events.length;
  if (len <= 3) return [];

  let severity: Severity;
  if (len > 8) severity = 'error';
  else if (len > 5) severity = 'warning';
  else severity = 'info';

  return [
    {
      id: 'CHAIN_LENGTH',
      severity,
      title: 'Long redirect chain',
      detail: `Chain has ${len} hops. ${len > 5 ? 'This significantly impacts page load time.' : 'Consider reducing unnecessary hops.'}`,
    },
  ];
}

// ---- 2. Loop detection ----

function checkLoop(_record: RedirectRecord, events: RedirectEvent[]): AnalysisIssue[] {
  // Track destinations: a loop means the same URL is visited more than once.
  // Chain linkage (to[N] == from[N+1]) is normal and should not flag.
  const visited = new Map<string, number>(); // url → first event index

  // The initial from URL is the first "visit"
  if (events.length > 0 && events[0].from) {
    visited.set(events[0].from, 0);
  }

  for (let i = 0; i < events.length; i++) {
    const dest = events[i].to;
    if (!dest) continue;

    const prevIdx = visited.get(dest);
    if (prevIdx !== undefined) {
      const host = getHost(dest) || dest;
      return [
        {
          id: 'LOOP',
          severity: 'warning',
          title: 'Redirect loop detected',
          detail: `URL on ${host} is visited more than once in the chain.`,
          hops: [prevIdx, i],
        },
      ];
    }
    visited.set(dest, i);
  }

  return [];
}

// ---- 3. Ping-pong ----

function checkPingPong(_record: RedirectRecord, events: RedirectEvent[]): AnalysisIssue[] {
  for (let i = 0; i + 2 < events.length; i++) {
    const hostA = getHost(events[i].from);
    const hostB = getHost(events[i].to) || getHost(events[i + 1]?.from);
    const hostC = getHost(events[i + 1]?.to) || getHost(events[i + 2]?.from);

    if (hostA && hostB && hostC && hostA !== hostB && hostA === hostC) {
      return [
        {
          id: 'PING_PONG',
          severity: 'warning',
          title: 'Ping-pong redirect',
          detail: `Hosts alternate: ${hostA} \u2192 ${hostB} \u2192 ${hostA}.`,
          hops: [i, i + 1, i + 2],
        },
      ];
    }
  }
  return [];
}

// ---- 4. Redirect types ----

function checkRedirectTypes(_record: RedirectRecord, events: RedirectEvent[]): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  let hasPermanent = false;
  let hasTemporary = false;
  const jsHops: number[] = [];

  for (let i = 0; i < events.length; i++) {
    const code = events[i].statusCode;
    const numCode = typeof code === 'string' ? Number.parseInt(code, 10) : code;

    if (numCode === 301 || numCode === 308) hasPermanent = true;
    if (numCode === 302 || numCode === 303 || numCode === 307) hasTemporary = true;
    if (code === 'JS' || events[i].method === 'CLIENT' || events[i].type === 'client-redirect') {
      jsHops.push(i);
    }
  }

  if (hasPermanent && hasTemporary) {
    issues.push({
      id: 'REDIRECT_TYPES',
      severity: 'info',
      title: 'Mixed redirect types',
      detail: 'Chain contains both permanent (301/308) and temporary (302/303/307) redirects.',
    });
  }

  if (jsHops.length > 0) {
    issues.push({
      id: 'REDIRECT_TYPES',
      severity: 'warning',
      title: 'Client-side redirect',
      detail: `${jsHops.length} hop${jsHops.length > 1 ? 's use' : ' uses'} JavaScript/client-side redirection, which is slower than server-side.`,
      hops: jsHops,
    });
  }

  return issues;
}

// ---- 5. Final outcome ----

function checkFinalOutcome(record: RedirectRecord, _events: RedirectEvent[]): AnalysisIssue[] {
  if (record.error) {
    return [
      {
        id: 'FINAL_OUTCOME',
        severity: 'error',
        title: 'Network error',
        detail: record.error,
      },
    ];
  }

  const code = record.finalStatus;
  if (code && code >= 400) {
    return [
      {
        id: 'FINAL_OUTCOME',
        severity: 'error',
        title: `Final status ${code}`,
        detail:
          code >= 500
            ? 'The server returned a server error after the redirect chain.'
            : 'The final destination returned a client error (e.g. not found or forbidden).',
      },
    ];
  }

  return [];
}

// ---- 6. Auth bounce ----

const AUTH_PATTERNS = [
  /\/oauth/i,
  /\/auth/i,
  /\/login/i,
  /\/signin/i,
  /\/sso/i,
  /\/callback/i,
  /\/saml/i,
  /\/cas/i,
  /\/openid/i,
  /[?&]redirect_uri=/i,
  /[?&]return_to=/i,
  /[?&]returnUrl=/i,
  /[?&]next=/i,
];

function checkAuthBounce(_record: RedirectRecord, events: RedirectEvent[]): AnalysisIssue[] {
  const authHops: number[] = [];

  for (let i = 0; i < events.length; i++) {
    const urls = [events[i].from, events[i].to].filter(Boolean);
    if (urls.some((url) => AUTH_PATTERNS.some((rx) => rx.test(url)))) {
      authHops.push(i);
    }
  }

  if (authHops.length === 0) return [];

  return [
    {
      id: 'AUTH_BOUNCE',
      severity: 'info',
      title: 'Authentication flow detected',
      detail: `${authHops.length} hop${authHops.length > 1 ? 's involve' : ' involves'} OAuth/login/SSO URL patterns.`,
      hops: authHops,
    },
  ];
}

// ---- 7. Locale / consent ----

const LOCALE_CONSENT_PATTERNS = [
  /\/(?:en|de|fr|es|it|pt|nl|ja|ko|zh|ru|pl|sv|da|no|fi|cs|tr|ar|he|th|vi|id|ms|uk|ro|hu|bg|hr|sk|sl|et|lv|lt)(?:[-_][a-z]{2})?\//i,
  /\/consent/i,
  /\/cookie-?policy/i,
  /\/gdpr/i,
  /\/privacy-?consent/i,
  /\/accept-?cookies/i,
  /[?&]consent=/i,
  /[?&]lang=/i,
  /[?&]locale=/i,
  /[?&]hl=/i,
  /[?&]cc=/i,
];

function checkLocaleConsent(_record: RedirectRecord, events: RedirectEvent[]): AnalysisIssue[] {
  const hops: number[] = [];

  for (let i = 0; i < events.length; i++) {
    const urls = [events[i].from, events[i].to].filter(Boolean);
    if (urls.some((url) => LOCALE_CONSENT_PATTERNS.some((rx) => rx.test(url)))) {
      hops.push(i);
    }
  }

  if (hops.length === 0) return [];

  return [
    {
      id: 'LOCALE_CONSENT',
      severity: 'info',
      title: 'Locale or consent redirect',
      detail: `${hops.length} hop${hops.length > 1 ? 's match' : ' matches'} language, region, or cookie-consent URL patterns.`,
      hops,
    },
  ];
}

// ---- 8. Tracking noise ----

function checkTrackingNoise(record: RedirectRecord, events: RedirectEvent[]): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];

  const noiseHops: number[] = [];
  for (let i = 0; i < events.length; i++) {
    if (events[i].noise) noiseHops.push(i);
  }

  if (noiseHops.length > 0) {
    issues.push({
      id: 'TRACKING_NOISE',
      severity: 'info',
      title: 'Tracking hops in chain',
      detail: `${noiseHops.length} hop${noiseHops.length > 1 ? 's are' : ' is'} flagged as tracking/noise.`,
      hops: noiseHops,
    });
  }

  if (record.classification === 'likely-tracking') {
    issues.push({
      id: 'TRACKING_NOISE',
      severity: 'info',
      title: 'Tracking chain',
      detail: record.classificationReason || 'Entire chain classified as likely tracking.',
    });
  }

  const noiseCount = record.noiseEvents?.length ?? 0;
  if (noiseCount > 0) {
    issues.push({
      id: 'TRACKING_NOISE',
      severity: 'info',
      title: 'Hidden noise events',
      detail: `${noiseCount} additional noise event${noiseCount > 1 ? 's were' : ' was'} filtered from display.`,
    });
  }

  return issues;
}

// ---- 9. CDN ----

const CDN_HOST_PATTERNS = [
  'cloudfront.net',
  'akamai',
  'fastly',
  'cloudflare',
  'cdn.',
  'edgecast',
  'stackpath',
  'bunnycdn',
  'keycdn',
  'azureedge.net',
  'akamaized.net',
  'edgekey.net',
];

function isCdnHost(host: string): boolean {
  const lower = host.toLowerCase();
  return CDN_HOST_PATTERNS.some((pat) => lower.includes(pat));
}

function checkCdn(_record: RedirectRecord, events: RedirectEvent[]): AnalysisIssue[] {
  const cdnHops: number[] = [];

  for (let i = 0; i < events.length; i++) {
    const fromHost = getHost(events[i].from);
    const toHost = getHost(events[i].to);
    if ((fromHost && isCdnHost(fromHost)) || (toHost && isCdnHost(toHost))) {
      cdnHops.push(i);
    }
  }

  if (cdnHops.length === 0) return [];

  return [
    {
      id: 'CDN',
      severity: 'info',
      title: 'CDN hop detected',
      detail: `${cdnHops.length} hop${cdnHops.length > 1 ? 's involve' : ' involves'} CDN infrastructure (CloudFront, Akamai, Fastly, Cloudflare, etc.).`,
      hops: cdnHops,
    },
  ];
}

// ---- Build hop annotations ----

function buildHopAnnotations(events: RedirectEvent[], issues: AnalysisIssue[]): HopAnnotation[] {
  const tagsByHop = new Map<number, Set<string>>();

  const ensure = (idx: number): Set<string> => {
    let set = tagsByHop.get(idx);
    if (!set) {
      set = new Set();
      tagsByHop.set(idx, set);
    }
    return set;
  };

  // Status-based tags (permanent/temporary omitted — status code badge already conveys this)
  for (let i = 0; i < events.length; i++) {
    const code = events[i].statusCode;

    if (code === 'JS' || events[i].method === 'CLIENT' || events[i].type === 'client-redirect') {
      ensure(i).add('client-side');
    }
    if (code === 'HSTS' || String(code) === '0') ensure(i).add('HSTS');
    if (events[i].noise) ensure(i).add('tracking');
  }

  // CDN tags
  for (let i = 0; i < events.length; i++) {
    const fromHost = getHost(events[i].from);
    const toHost = getHost(events[i].to);
    if ((fromHost && isCdnHost(fromHost)) || (toHost && isCdnHost(toHost))) {
      ensure(i).add('CDN');
    }
  }

  // Issue-derived tags
  for (const issue of issues) {
    if (!issue.hops) continue;
    const tag =
      issue.id === 'AUTH_BOUNCE'
        ? 'auth-flow'
        : issue.id === 'LOCALE_CONSENT'
          ? 'locale/consent'
          : issue.id === 'LOOP'
            ? 'loop'
            : issue.id === 'PING_PONG'
              ? 'ping-pong'
              : null;
    if (tag) {
      for (const idx of issue.hops) ensure(idx).add(tag);
    }
  }

  const annotations: HopAnnotation[] = [];
  for (let i = 0; i < events.length; i++) {
    const set = tagsByHop.get(i);
    annotations.push({ index: i, tags: set ? Array.from(set) : [] });
  }
  return annotations;
}

// ---- Build global tags ----

function buildGlobalTags(annotations: HopAnnotation[], issues: AnalysisIssue[]): string[] {
  const tagSet = new Set<string>();

  for (const ann of annotations) {
    for (const t of ann.tags) tagSet.add(t);
  }

  // Add issue-level tags (skip 'error' — already shown as issue card)
  for (const issue of issues) {
    if (issue.id === 'TRACKING_NOISE') tagSet.add('tracking');
  }

  return Array.from(tagSet);
}

// ---- Build summary ----

function buildSummary(events: RedirectEvent[], issues: AnalysisIssue[]): string {
  const parts: string[] = [];
  parts.push(`${events.length} hop${events.length !== 1 ? 's' : ''}`);

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;

  if (errorCount > 0) parts.push(`${errorCount} error${errorCount > 1 ? 's' : ''}`);
  if (warningCount > 0) parts.push(`${warningCount} warning${warningCount > 1 ? 's' : ''}`);
  if (infoCount > 0) parts.push(`${infoCount} info`);

  if (errorCount === 0 && warningCount === 0 && infoCount === 0) {
    parts.push('no issues');
  }

  return parts.join(' \u00b7 ');
}

// ---- Main entry point ----

const HEURISTICS: Array<(record: RedirectRecord, events: RedirectEvent[]) => AnalysisIssue[]> = [
  checkChainLength,
  checkLoop,
  checkPingPong,
  checkRedirectTypes,
  checkFinalOutcome,
  checkAuthBounce,
  checkLocaleConsent,
  checkTrackingNoise,
  checkCdn,
];

export function analyzeChain(record: RedirectRecord): AnalysisResult {
  const events = Array.isArray(record.events) ? record.events : [];

  const allIssues: AnalysisIssue[] = [];
  for (const heuristic of HEURISTICS) {
    allIssues.push(...heuristic(record, events));
  }

  const issues = sortBySeverity(allIssues);
  const hopAnnotations = buildHopAnnotations(events, issues);
  const tags = buildGlobalTags(hopAnnotations, issues);
  const summary = buildSummary(events, issues);

  return { summary, issues, tags, hopAnnotations };
}
