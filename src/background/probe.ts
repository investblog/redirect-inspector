/**
 * Manual "check a URL" probes. The URL opens in an inactive tab so the normal
 * webRequest pipeline records the chain — the extension itself makes no
 * request. The tab is closed as soon as its top-level chain finalizes (with a
 * timeout fallback), and the resulting record is flagged `manual`.
 *
 * Caveat by design: the navigation carries the user's cookies, so the captured
 * chain is the personalized one, not a clean-crawler view.
 */

import { browser } from 'wxt/browser';
import type { RedirectRecord } from '../shared/types/redirect';
import { formatTimestamp, MAX_RECORDS, REDIRECT_LOG_KEY } from './helpers';

/** tabId -> originally requested URL. */
export const probeTabs = new Map<number, string>();

const PROBE_TAB_TIMEOUT_MS = 20_000;
/** Longer than CLIENT_REDIRECT_EXTENDED_AWAIT_MS so a JS redirect can still start. */
const PROBE_NO_REDIRECT_SETTLE_MS = 5_500;
/** storage.session mirror so an MV3 SW restart can sweep leaked probe tabs. */
const PROBE_SESSION_KEY = 'redirectInspector:probeTabs';

interface SessionArea {
  get: (defaults: Record<string, unknown>) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}

function sessionStore(): SessionArea | undefined {
  return (browser.storage as any)?.session;
}

function persistProbeTabs(): void {
  sessionStore()
    ?.set({ [PROBE_SESSION_KEY]: Array.from(probeTabs.keys()) })
    .catch(() => {});
}

export async function startUrlProbe(rawUrl: string): Promise<{ success: boolean; error?: string }> {
  let url: string;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { success: false, error: 'Only http(s) URLs can be checked' };
    }
    url = parsed.toString();
  } catch {
    return { success: false, error: 'Invalid URL' };
  }

  try {
    const tab = await browser.tabs.create({ url, active: false });
    if (typeof tab.id === 'number') {
      const tabId = tab.id;
      probeTabs.set(tabId, url);
      persistProbeTabs();
      setTimeout(() => closeProbeTab(tabId), PROBE_TAB_TIMEOUT_MS);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error)?.message || 'Failed to open tab' };
  }
}

/** Idempotent: closes the tab only if it is still a tracked probe. */
export function closeProbeTab(tabId: number): void {
  if (!probeTabs.delete(tabId)) {
    return;
  }
  persistProbeTabs();
  browser.tabs.remove(tabId).catch(() => {
    /* already closed by the user */
  });
}

/**
 * A probe URL that never redirects creates no chain (chains exist only once a
 * redirect happens), so nothing would be recorded. Called from the main_frame
 * onCompleted path when no chain exists yet: after a settle window (a JS
 * redirect may still fire), synthesize a zero-hop `manual` record.
 */
export function handleProbeDirectCompletion(
  details: { tabId?: number; url?: string; statusCode?: number; timeStamp?: number },
  tabHasChain: (tabId: number) => boolean,
): void {
  const tabId = details.tabId;
  if (typeof tabId !== 'number' || !probeTabs.has(tabId)) {
    return;
  }

  const initialUrl = probeTabs.get(tabId);
  setTimeout(() => {
    if (!probeTabs.has(tabId) || tabHasChain(tabId)) {
      return;
    }
    const record: RedirectRecord = {
      id: crypto.randomUUID(),
      tabId,
      manual: true,
      initiatedAt: formatTimestamp(details.timeStamp),
      completedAt: formatTimestamp(),
      initialUrl,
      finalUrl: details.url,
      finalStatus: details.statusCode,
      error: null,
      events: [],
      classification: 'normal',
    };
    void (async () => {
      try {
        const { [REDIRECT_LOG_KEY]: existing = [] } = await browser.storage.local.get(REDIRECT_LOG_KEY);
        const updated = [record, ...(existing as RedirectRecord[])].slice(0, MAX_RECORDS);
        await browser.storage.local.set({ [REDIRECT_LOG_KEY]: updated });
      } catch (error) {
        console.warn('Failed to persist manual check record', error);
      }
      closeProbeTab(tabId);
    })();
  }, PROBE_NO_REDIRECT_SETTLE_MS);
}

/** SW-start sweep: close probe tabs orphaned by a service-worker restart. */
export function setupProbe(): void {
  const session = sessionStore();
  if (!session) {
    return;
  }
  void (async () => {
    try {
      const stored = await session.get({ [PROBE_SESSION_KEY]: [] });
      const ids = stored[PROBE_SESSION_KEY] as number[];
      for (const tabId of ids) {
        if (!probeTabs.has(tabId)) {
          browser.tabs.remove(tabId).catch(() => {});
        }
      }
      if (ids.length > 0 && probeTabs.size === 0) {
        await session.set({ [PROBE_SESSION_KEY]: [] });
      }
    } catch {
      /* session storage unavailable */
    }
  })();
}
