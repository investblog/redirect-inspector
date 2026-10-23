export interface RedirectEvent {
  timestamp: string;
  timestampMs?: number;
  from: string;
  to: string;
  statusCode: number | string;
  method: string;
  ip?: string;
  type: string;
  noise?: boolean;
  noiseReason?: string | null;
}

export interface RedirectRecord {
  id: string;
  requestId?: string;
  tabId: number;
  initiator?: string;
  initiatedAt: string;
  completedAt?: string;
  initialUrl?: string;
  finalUrl?: string;
  finalStatus?: number;
  error?: string | null;
  events: RedirectEvent[];
  noiseEvents?: RedirectEvent[];
  classification?: Classification;
  classificationReason?: string;
  contentType?: string;
  contentLength?: number;
  pending?: boolean;
  awaitingClientRedirect?: boolean;
  awaitingClientRedirectDeadline?: number;
  /** Synthetic first-run example chain, labeled in the UI; removed by Clear like any record. */
  demo?: boolean;
  /** Captured via the manual "check a URL" probe (background tab navigation). */
  manual?: boolean;
  /**
   * Where the address bar ended up after same-document changes (hash, History API)
   * on the final page — no server request involved, so not a hop. Set only when it
   * differs from finalUrl.
   */
  clientLanding?: ClientLanding;
}

export interface ClientLanding {
  /** Final address after client-side changes; sensitive values already masked. */
  url: string;
  /** 'fragment' — only the hash changed; 'history' — History API (or mixed). */
  via: 'fragment' | 'history';
  /** From the final document's completion to the last change, ms; 0 if earlier. */
  delayMs: number;
  /** How many changes were collapsed into this one. */
  changes: number;
  /** Values were masked — the URL may not work, so it must not be opened. */
  redacted: boolean;
}

export type Classification = 'normal' | 'likely-tracking' | 'likely-media';

export interface ClassificationResult {
  classification: Classification;
  classificationReason?: string;
  contentType?: string;
  contentLength?: number | null;
}

export interface ChainCompletionDetails {
  requestId?: string;
  tabId?: number;
  url?: string;
  type?: string;
  statusCode?: number;
  timeStamp?: number;
  responseHeaders?: chrome.webRequest.HttpHeader[];
}

export interface ChainFinalDetails {
  details: ChainCompletionDetails;
  errorMessage: string | null;
}

export interface Chain {
  id: string;
  requestIds: Set<string>;
  tabId: number;
  initiator?: string;
  initiatedAt: string;
  events: RedirectEvent[];
  initialUrl?: string;
  pendingFinalDetails: ChainFinalDetails | null;
  finalizeTimer: ReturnType<typeof setTimeout> | null;
  awaitingClientRedirect: boolean;
  awaitingClientRedirectTimer: ReturnType<typeof setTimeout> | null;
  awaitingClientRedirectDeadline: number | null;
  awaitingClientRedirectInterval: ReturnType<typeof setInterval> | null;
  awaitingBadgeToggle: boolean;
  awaitingBadgeFinalColor: string | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  pendingRedirectTargetKeys: Set<string>;
}

export interface PreparedEvents {
  normalizedEvents: RedirectEvent[];
  normalizedNoiseEvents: RedirectEvent[];
  allEventsNoisy: boolean;
  firstEvent: RedirectEvent | null;
  lastEvent: RedirectEvent | null;
}
