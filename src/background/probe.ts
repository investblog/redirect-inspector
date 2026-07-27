/**
 * Manual "check a URL" probes. The URL opens in an inactive tab so the normal
 * webRequest pipeline records the chain — the extension itself makes no
 * request. The tab is closed as soon as its chain finalizes (with a timeout
 * fallback), and the resulting record is flagged `manual`.
 *
 * Caveat by design: the navigation carries the user's cookies, so the captured
 * chain is the personalized one, not a clean-crawler view.
 */

import { browser } from 'wxt/browser';

export const probeTabIds = new Set<number>();

const PROBE_TAB_TIMEOUT_MS = 20_000;

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
      probeTabIds.add(tabId);
      setTimeout(() => closeProbeTab(tabId), PROBE_TAB_TIMEOUT_MS);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error)?.message || 'Failed to open tab' };
  }
}

/** Idempotent: closes the tab only if it is still a tracked probe. */
export function closeProbeTab(tabId: number): void {
  if (!probeTabIds.delete(tabId)) {
    return;
  }
  browser.tabs.remove(tabId).catch(() => {
    /* already closed by the user */
  });
}
