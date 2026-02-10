import { browser } from 'wxt/browser';
import type { Chain, RedirectRecord } from '../shared/types/redirect';
import { BADGE_COLOR, BADGE_COUNTDOWN_COLOR, formatBadgeText, handleChromePromise } from './helpers';

interface BadgeOptions {
  text?: string;
  color?: string;
}

export function setBadgeForTab(tabId: number, hopCount: number, options: BadgeOptions = {}): void {
  if (!browser?.action?.setBadgeText) {
    return;
  }

  if (typeof tabId !== 'number' || tabId < 0) {
    return;
  }

  const text = typeof options.text === 'string' ? options.text : formatBadgeText(hopCount);
  try {
    const result = browser.action.setBadgeText({ tabId, text });
    handleChromePromise(result, 'Failed to set badge text');
  } catch (error: unknown) {
    const err = error as Error;
    if (!err?.message || !err.message.includes('No tab with id')) {
      console.error('Failed to set badge text', error);
    }
    return;
  }

  if (text && browser?.action?.setBadgeBackgroundColor) {
    try {
      const color = options.color || BADGE_COLOR;
      const result = browser.action.setBadgeBackgroundColor({ tabId, color });
      handleChromePromise(result, 'Failed to set badge background color');
    } catch (error: unknown) {
      const err = error as Error;
      if (!err?.message || !err.message.includes('No tab with id')) {
        console.error('Failed to set badge background color', error);
      }
    }
  }
}

export async function clearAllBadges(): Promise<void> {
  if (!browser?.action?.setBadgeText) {
    return;
  }

  if (!browser?.tabs?.query) {
    browser.action.setBadgeText({ text: '' });
    return;
  }

  try {
    const tabs = await browser.tabs.query({});
    await Promise.all(
      tabs.map((tab) => {
        if (typeof tab.id !== 'number') {
          return Promise.resolve();
        }

        return browser.action.setBadgeText({ tabId: tab.id, text: '' });
      }),
    );
  } catch (error) {
    console.error('Failed to clear badge text', error);
  }
}

export function updateBadgeForChain(chain: Chain): void {
  if (!chain) {
    return;
  }

  if (chain.awaitingBadgeFinalColor && typeof chain.tabId === 'number' && chain.tabId >= 0) {
    const hopCount = Array.isArray(chain.events) ? chain.events.length : 0;
    const color = chain.awaitingBadgeFinalColor;
    chain.awaitingBadgeFinalColor = null;
    setBadgeForTab(chain.tabId, hopCount, { color });
    return;
  }

  if (chain.awaitingClientRedirect && chain.awaitingClientRedirectDeadline) {
    renderAwaitingBadge(chain);
    return;
  }

  const hopCount = Array.isArray(chain.events) ? chain.events.length : 0;
  setBadgeForTab(chain.tabId, hopCount);
}

interface AwaitingBadgeOptions {
  toggle?: boolean;
}

export function renderAwaitingBadge(chain: Chain, options: AwaitingBadgeOptions = {}): void {
  if (!chain) {
    return;
  }

  if (options.toggle) {
    chain.awaitingBadgeToggle = !chain.awaitingBadgeToggle;
  }

  const hopCount = Array.isArray(chain.events) ? chain.events.length : 0;

  if (typeof chain.tabId !== 'number' || chain.tabId < 0) {
    return;
  }

  const deadline =
    typeof chain.awaitingClientRedirectDeadline === 'number' ? chain.awaitingClientRedirectDeadline : null;
  if (!deadline) {
    setBadgeForTab(chain.tabId, hopCount);
    return;
  }

  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    setBadgeForTab(chain.tabId, hopCount);
    return;
  }

  if (chain.awaitingBadgeToggle) {
    const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    setBadgeForTab(chain.tabId, hopCount, { text: String(remainingSeconds), color: BADGE_COUNTDOWN_COLOR });
    return;
  }

  setBadgeForTab(chain.tabId, hopCount);
}

export function stopAwaitingClientRedirectCountdown(chain: Chain): void {
  if (!chain) {
    return;
  }

  if (chain.awaitingClientRedirectInterval) {
    clearInterval(chain.awaitingClientRedirectInterval);
    chain.awaitingClientRedirectInterval = null;
  }

  chain.awaitingClientRedirectDeadline = null;
  chain.awaitingBadgeToggle = false;
}

export function updateBadgeForRecord(record: RedirectRecord): void {
  if (!record) {
    return;
  }

  const hopCount = Array.isArray(record.events) ? record.events.length : 0;
  setBadgeForTab(record.tabId, hopCount);
}
