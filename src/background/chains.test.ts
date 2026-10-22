import { describe, expect, it, vi } from 'vitest';

// No badge/storage APIs: badge helpers bail out when browser.action is absent.
vi.mock('wxt/browser', () => ({ browser: {} }));

const { handleWebNavigationCommitted, tabLastCommittedUrl } = await import('./chains');

function commit(frameId: number, url: string): void {
  handleWebNavigationCommitted({
    tabId: 7,
    frameId,
    url,
    timeStamp: Date.now(),
  } as chrome.webNavigation.WebNavigationTransitionCallbackDetails);
}

describe('handleWebNavigationCommitted', () => {
  it('keeps the top-level URL when an iframe commits afterwards', () => {
    commit(0, 'https://site.example/page');
    commit(3, 'https://ads.example/frame');
    expect(tabLastCommittedUrl.get(7)).toBe('https://site.example/page');
  });

  it('updates the URL on a new top-level commit', () => {
    commit(0, 'https://site.example/next');
    expect(tabLastCommittedUrl.get(7)).toBe('https://site.example/next');
  });
});
