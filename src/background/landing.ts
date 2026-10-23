import type { ClientLanding } from '../shared/types/redirect';
import { LANDING_QUIET_MS, LANDING_WINDOW_MS, maskSensitiveUrl, PROBE_LANDING_WAIT_MS } from './helpers';
import { updateClientLanding } from './log';

// ---- Client-side landing: same-document URL changes on a chain's final page ----

export type LandingVia = ClientLanding['via'];

export interface LandingChange {
  url: string;
  via: LandingVia;
  /** Event timestamp, ms. */
  at: number;
}

/** Changes collected in one window, collapsed into the latest state. */
export interface LandingDraft {
  url: string;
  via: LandingVia;
  changes: number;
  firstAt: number;
  lastAt: number;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Fold one change into the draft. Ignored (draft returned as is): a change to
 * the address already shown — e.g. replaceState with the same URL — and one to
 * a different origin, which a same-document change cannot legitimately be.
 */
export function reduceLanding(draft: LandingDraft | null, change: LandingChange, baseUrl: string): LandingDraft | null {
  const current = draft?.url ?? baseUrl;
  if (change.url === current) return draft;

  const origin = originOf(change.url);
  if (!origin || origin !== originOf(baseUrl)) return draft;

  return {
    url: change.url,
    via: draft?.via === 'history' || change.via === 'history' ? 'history' : 'fragment',
    changes: (draft?.changes ?? 0) + 1,
    firstAt: draft?.firstAt ?? change.at,
    lastAt: change.at,
  };
}

/**
 * Turn a settled draft into the persisted field, or null when there is nothing
 * to record: no change, the page ended back on `finalUrl`, or the URL failed to
 * parse for masking (fail closed).
 */
export function toClientLanding(
  draft: LandingDraft | null,
  finalUrl: string | undefined,
  completedAt: number | undefined,
): ClientLanding | null {
  if (!draft || draft.url === finalUrl) return null;

  const masked = maskSensitiveUrl(draft.url);
  if (!masked) return null;

  return {
    url: masked.url,
    via: draft.via,
    delayMs: typeof completedAt === 'number' ? Math.max(0, Math.round(draft.lastAt - completedAt)) : 0,
    changes: draft.changes,
    redacted: masked.redacted,
  };
}

// ---- Per-tab capture state ----
//
// One context per tab, for the top-level document a redirect chain (or a manual
// check) ended on. Lifecycle: armed in onBeforeRequest(main_frame) → committed
// (documentId, base URL) → completed (deadline starts) → changes collapse into a
// draft → settled after LANDING_QUIET_MS of quiet or at the deadline. The chain
// record is usually written before the window settles (≈250 ms after commit), so
// the result is patched onto the stored record; if it settled first, the record
// picks it up when it is built.

interface LandingContext {
  /** Identity for timer callbacks: a replaced context must not act on stale timers. */
  token: symbol;
  chainId?: string;
  probe: boolean;
  committed: boolean;
  documentId?: string;
  baseUrl?: string;
  completedAt?: number;
  draft: LandingDraft | null;
  settled: boolean;
  /** 'recorded' once bound to a persisted record — the result goes out as a patch. */
  phase: 'pending' | 'recorded';
  recordId?: string;
  finalUrl?: string;
  /** Runs when a recorded context finishes (closes the probe tab). */
  onDone?: () => void;
  quietTimer: ReturnType<typeof setTimeout> | null;
  deadlineTimer: ReturnType<typeof setTimeout> | null;
}

const contexts = new Map<number, LandingContext>();

/**
 * The tab's current top-level document as webNavigation reported it, with the
 * changes seen since its commit. Needed because webNavigation and webRequest
 * events have no common order (Firefox delivers onCommitted — even a hash change
 * — before onBeforeRequest of the same document), so a context armed later must
 * be able to adopt the document. Memory only; replaced on the next commit.
 */
interface TabDocument {
  documentId?: string;
  url: string;
  committedAt: number;
  changes: LandingChange[];
}

const documents = new Map<number, TabDocument>();
const MAX_BUFFERED_CHANGES = 20;

/** The webNavigation fields this module reads; documentId/documentLifecycle are feature-detected. */
export interface LandingNavDetails {
  tabId: number;
  frameId: number;
  url: string;
  timeStamp: number;
  documentId?: string;
  documentLifecycle?: string;
}

function clearTimers(ctx: LandingContext): void {
  if (ctx.quietTimer) clearTimeout(ctx.quietTimer);
  if (ctx.deadlineTimer) clearTimeout(ctx.deadlineTimer);
  ctx.quietTimer = null;
  ctx.deadlineTimer = null;
}

/** Drop the context; a recorded one gets its result patched (when `patch`) and its onDone run. */
function finish(tabId: number, ctx: LandingContext, patch: boolean): void {
  clearTimers(ctx);
  if (contexts.get(tabId) === ctx) contexts.delete(tabId);

  if (ctx.phase !== 'recorded') return;

  if (patch && ctx.recordId) {
    const landing = toClientLanding(ctx.draft, ctx.finalUrl, ctx.completedAt);
    if (landing) {
      updateClientLanding(ctx.recordId, landing).catch((error) => {
        console.error('Failed to store client-side landing', error);
      });
    }
  }
  ctx.onDone?.();
}

function settle(tabId: number, ctx: LandingContext): void {
  clearTimers(ctx);
  ctx.settled = true;
  if (ctx.phase === 'recorded') finish(tabId, ctx, true);
  // Pending: keep the settled draft until the record is built (bindLandingToRecord).
}

function startTimer(tabId: number, ctx: LandingContext, kind: 'quietTimer' | 'deadlineTimer', ms: number): void {
  if (ctx[kind]) clearTimeout(ctx[kind]);
  const token = ctx.token;
  ctx[kind] = setTimeout(
    () => {
      const current = contexts.get(tabId);
      if (current?.token === token && !current.settled) settle(tabId, current);
    },
    Math.max(0, ms),
  );
}

function adoptDocument(ctx: LandingContext, doc: TabDocument): void {
  ctx.committed = true;
  ctx.documentId = doc.documentId;
  ctx.baseUrl = doc.url;
  for (const change of doc.changes) {
    ctx.draft = reduceLanding(ctx.draft, change, doc.url);
  }
}

/**
 * A new top-level request in the tab. Closes the previous document's context —
 * a chain continuing via a client redirect discards its draft (it belonged to an
 * intermediate page); otherwise a recorded draft is flushed as is. Arms a fresh
 * context only for a document a chain or a manual check led to. If that
 * document's commit was already delivered (webNavigation ran ahead), adopt it.
 */
export function armLandingContext(
  tabId: number,
  chainId: string | undefined,
  probe: boolean,
  requestUrl: string,
  requestTimeStamp: number,
): void {
  const previous = contexts.get(tabId);
  if (previous) finish(tabId, previous, previous.chainId === undefined || previous.chainId !== chainId);

  if (!chainId && !probe) return;

  const ctx: LandingContext = {
    token: Symbol('landing'),
    chainId,
    probe,
    committed: false,
    draft: null,
    settled: false,
    phase: 'pending',
    quietTimer: null,
    deadlineTimer: null,
  };
  contexts.set(tabId, ctx);

  const doc = documents.get(tabId);
  if (doc && doc.url === requestUrl && doc.committedAt >= requestTimeStamp) {
    adoptDocument(ctx, doc);
  }
}

/** webNavigation.onCommitted: the first top-level commit enriches the context; a later one is a new document. */
export function handleLandingCommitted(details: LandingNavDetails): void {
  if (details.frameId !== 0) return;
  const isHttp = /^https?:/i.test(details.url);
  if (isHttp) {
    documents.set(details.tabId, {
      documentId: details.documentId,
      url: details.url,
      committedAt: details.timeStamp,
      changes: [],
    });
  } else {
    documents.delete(details.tabId);
  }

  const ctx = contexts.get(details.tabId);
  if (!ctx) return;

  if (ctx.committed) {
    // A new document without a request we saw (back/forward cache, internal page).
    finish(details.tabId, ctx, true);
    return;
  }
  if (!isHttp) return; // e.g. the probe tab's about:blank

  const doc = documents.get(details.tabId);
  if (doc) adoptDocument(ctx, doc);
}

/**
 * The final document's main_frame response completed (webRequest.onCompleted,
 * which arrives just before onCommitted). Starts the deadline for the first
 * change; changes already collected get their quiet period.
 */
export function noteLandingCompleted(tabId: number, chainId: string | undefined, timeStamp: number): void {
  const ctx = contexts.get(tabId);
  if (!ctx || ctx.settled || ctx.chainId !== chainId || ctx.completedAt !== undefined) return;

  ctx.completedAt = timeStamp;
  const firstWait = ctx.probe ? PROBE_LANDING_WAIT_MS : LANDING_WINDOW_MS;
  startTimer(tabId, ctx, 'deadlineTimer', ctx.draft ? LANDING_WINDOW_MS : firstWait);
  if (ctx.draft) startTimer(tabId, ctx, 'quietTimer', LANDING_QUIET_MS);
}

/** webNavigation.onReferenceFragmentUpdated / onHistoryStateUpdated. */
export function handleLandingChange(details: LandingNavDetails, via: LandingVia): void {
  if (details.frameId !== 0) return;
  if (details.documentLifecycle !== undefined && details.documentLifecycle !== 'active') return;

  const tabId = details.tabId;
  const change: LandingChange = { url: details.url, via, at: details.timeStamp };

  // Buffer for a context armed after this event (see TabDocument).
  const doc = documents.get(tabId);
  if (doc && !(doc.documentId && details.documentId && doc.documentId !== details.documentId)) {
    doc.changes.push(change);
    if (doc.changes.length > MAX_BUFFERED_CHANGES) doc.changes.shift();
  }

  const ctx = contexts.get(tabId);
  if (!ctx || ctx.settled || !ctx.committed || !ctx.baseUrl) return;
  if (ctx.documentId && details.documentId && ctx.documentId !== details.documentId) return;

  const draft = reduceLanding(ctx.draft, change, ctx.baseUrl);
  if (draft === ctx.draft) return;

  const firstChange = ctx.draft === null;
  ctx.draft = draft;
  if (ctx.completedAt === undefined) return; // timers start at completion
  if (firstChange) {
    // Switch from "wait for a first change" to the hard cap.
    startTimer(tabId, ctx, 'deadlineTimer', ctx.completedAt + LANDING_WINDOW_MS - Date.now());
  }
  startTimer(tabId, ctx, 'quietTimer', LANDING_QUIET_MS);
}

/**
 * Called while building the record for the tab's chain (`chainId`) or its
 * zero-hop manual check (`chainId` undefined). A settled window is returned to
 * go straight into the record; an open one is bound to `recordId` and patched
 * when it settles — then `onDone` runs (`deferred: true`). Without a matching
 * context there is nothing to wait for.
 */
export function bindLandingToRecord(
  tabId: number,
  chainId: string | undefined,
  recordId: string,
  finalUrl: string | undefined,
  onDone?: () => void,
): { landing: ClientLanding | null; deferred: boolean } {
  const ctx = contexts.get(tabId);
  if (!ctx || ctx.chainId !== chainId || ctx.phase === 'recorded') {
    return { landing: null, deferred: false };
  }

  if (ctx.settled) {
    contexts.delete(tabId);
    return { landing: toClientLanding(ctx.draft, finalUrl, ctx.completedAt), deferred: false };
  }

  // Never committed nor completed (request failed, forced finalization): there
  // is no document whose address could still change.
  if (!ctx.committed && ctx.completedAt === undefined) {
    finish(tabId, ctx, false);
    return { landing: null, deferred: false };
  }

  ctx.phase = 'recorded';
  ctx.recordId = recordId;
  ctx.finalUrl = finalUrl;
  ctx.onDone = onDone;
  // Committed but never completed (forced finalization of a page still
  // loading): no completion will start the timers, so cap the window here.
  if (ctx.completedAt === undefined) {
    startTimer(tabId, ctx, 'deadlineTimer', ctx.draft || !ctx.probe ? LANDING_WINDOW_MS : PROBE_LANDING_WAIT_MS);
    if (ctx.draft) startTimer(tabId, ctx, 'quietTimer', LANDING_QUIET_MS);
  }
  return { landing: null, deferred: true };
}

/** The chain's record will never be written (all hops are noise): drop its window and draft now. */
export function discardLandingContext(tabId: number, chainId: string): void {
  const ctx = contexts.get(tabId);
  if (ctx?.chainId === chainId && ctx.phase !== 'recorded') finish(tabId, ctx, false);
}

/** Tab closed or its request failed: flush what was collected for a recorded document, drop the rest. */
export function closeLandingContext(tabId: number): void {
  documents.delete(tabId);
  const ctx = contexts.get(tabId);
  if (ctx) finish(tabId, ctx, true);
}

/**
 * Clear of the log: every open window stops without patching — a record
 * restored by Undo must not change afterwards. Deferred probe tabs still close.
 */
export function disarmLandingContexts(): void {
  for (const [tabId, ctx] of Array.from(contexts)) finish(tabId, ctx, false);
}
