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
