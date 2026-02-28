import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/sandbox';
import {
  chainsById,
  cleanupTabState,
  clearAllBadges,
  handleBeforeRedirect,
  handleBeforeRequest,
  handleRequestCompleted,
  handleRequestError,
  handleWebNavigationCommitted,
  serializeChainPreview,
} from '../../background';
import { REDIRECT_LOG_KEY, WEB_REQUEST_EXTRA_INFO_SPEC, WEB_REQUEST_FILTER } from '../../background/helpers';

export default defineBackground(() => {
  // ---- onInstalled: open welcome page on first install ----
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') {
      browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') });
    }
  });

  // ---- webRequest listeners ----
  // Handlers use chrome.webRequest types; browser types differ slightly but are compatible at runtime
  try {
    if (browser?.webRequest?.onBeforeRequest) {
      browser.webRequest.onBeforeRequest.addListener(handleBeforeRequest as any, WEB_REQUEST_FILTER);
    }

    if (browser?.webRequest?.onBeforeRedirect) {
      browser.webRequest.onBeforeRedirect.addListener(
        handleBeforeRedirect as any,
        WEB_REQUEST_FILTER,
        WEB_REQUEST_EXTRA_INFO_SPEC as any[],
      );
    }

    if (browser?.webRequest?.onCompleted) {
      browser.webRequest.onCompleted.addListener(
        handleRequestCompleted as any,
        WEB_REQUEST_FILTER,
        WEB_REQUEST_EXTRA_INFO_SPEC as any[],
      );
    }

    if (browser?.webRequest?.onErrorOccurred) {
      browser.webRequest.onErrorOccurred.addListener(handleRequestError as any, WEB_REQUEST_FILTER);
    }
  } catch (error) {
    console.error('Failed to register webRequest listeners', error);
  }

  // ---- webNavigation ----
  if (browser?.webNavigation?.onCommitted) {
    browser.webNavigation.onCommitted.addListener(handleWebNavigationCommitted as any);
  }

  // ---- tab cleanup ----
  if (browser?.tabs?.onRemoved) {
    browser.tabs.onRemoved.addListener((tabId) => {
      cleanupTabState(tabId);
    });
  }

  // ---- runtime messages (popup/sidepanel <-> background) ----
  browser.runtime.onMessage.addListener(((message: any, _sender: any, sendResponse: any) => {
    const type = message?.type;

    if (type === 'redirect-inspector:get-log') {
      browser.storage.local
        .get({ [REDIRECT_LOG_KEY]: [] })
        .then((result) => {
          const pendingRecords = Array.from(chainsById.values())
            .map((chain) => serializeChainPreview(chain))
            .filter((record) => record && Array.isArray(record.events) && record.events.length > 0);

          sendResponse({ log: result[REDIRECT_LOG_KEY], pending: pendingRecords });
        })
        .catch((error) => {
          console.error('Failed to read redirect log', error);
          sendResponse({ log: [], pending: [], error: (error as Error)?.message || 'Unknown error' });
        });

      return true;
    }

    if (type === 'redirect-inspector:clear-log' || type === 'redirect-inspector:clear-redirects') {
      browser.storage.local
        .set({ [REDIRECT_LOG_KEY]: [] })
        .then(() => {
          clearAllBadges();
          sendResponse({ success: true });
        })
        .catch((error) => {
          console.error('Failed to clear redirect log', error);
          sendResponse({ success: false, error: (error as Error)?.message || 'Unknown error' });
        });

      return true;
    }

    sendResponse({ ok: false, error: 'Unknown message type' });
    return false;
  }) as any);
});
