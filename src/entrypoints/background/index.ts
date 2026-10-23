import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/sandbox';
import {
  chainsById,
  cleanupTabState,
  clearAllBadges,
  clearRedirectLog,
  disableNewsAlarm,
  disarmLandingContexts,
  enableNewsAlarm,
  forceFinalizeTabChains,
  handleBeforeRedirect,
  handleBeforeRequest,
  handleLandingChange,
  handleLandingCommitted,
  handleRequestCompleted,
  handleRequestError,
  handleWebNavigationCommitted,
  restoreRedirectRecords,
  seedDemoRecordIfEmpty,
  serializeChainPreview,
  setupNews,
  setupProbe,
  startUrlProbe,
} from '../../background';
import { REDIRECT_LOG_KEY, WEB_REQUEST_EXTRA_INFO_SPEC, WEB_REQUEST_FILTER } from '../../background/helpers';
import { setNewsEnabled } from '../../shared/news';

export default defineBackground(() => {
  // ---- Chromium: icon click opens the side panel (popup is Firefox-only UX) ----
  (browser as any).sidePanel
    ?.setPanelBehavior?.({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.warn('setPanelBehavior failed', error));

  // ---- onInstalled: open welcome page on first install ----
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') {
      void seedDemoRecordIfEmpty();
      browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') });
    }
  });

  // ---- Uninstall feedback: opens once, when the user removes the extension ----
  browser.runtime
    .setUninstallURL?.(
      'https://301.st/contact?utm_source=redirect-inspector&utm_medium=extension&utm_campaign=uninstall',
    )
    ?.catch((error: unknown) => console.warn('setUninstallURL failed', error));

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
    browser.webNavigation.onCommitted.addListener(handleLandingCommitted as any);
  }

  // Same-document changes on a chain's final page (hash / History API): no
  // request, so webRequest never sees them — recorded as the client-side landing.
  browser?.webNavigation?.onReferenceFragmentUpdated?.addListener((details: any) =>
    handleLandingChange(details, 'fragment'),
  );
  browser?.webNavigation?.onHistoryStateUpdated?.addListener((details: any) => handleLandingChange(details, 'history'));

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
      // Open landing windows stop first: nothing may patch a record restored by Undo.
      disarmLandingContexts();
      clearRedirectLog()
        .then((cleared) => {
          clearAllBadges();
          sendResponse({ success: true, cleared });
        })
        .catch((error) => {
          console.error('Failed to clear redirect log', error);
          sendResponse({ success: false, error: (error as Error)?.message || 'Unknown error' });
        });

      return true;
    }

    if (type === 'redirect-inspector:restore-log') {
      const records = Array.isArray(message?.payload?.records) ? message.payload.records : [];
      restoreRedirectRecords(records)
        .then(() => sendResponse({ success: true }))
        .catch((error) => {
          console.error('Failed to restore redirect log', error);
          sendResponse({ success: false, error: (error as Error)?.message || 'Unknown error' });
        });

      return true;
    }

    if (type === 'redirect-inspector:set-news-enabled') {
      const enabled = Boolean(message?.payload?.enabled);
      setNewsEnabled(enabled)
        .then(() => (enabled ? enableNewsAlarm() : disableNewsAlarm()))
        .then(() => sendResponse({ success: true }))
        .catch((error) => {
          console.error('Failed to toggle news notifications', error);
          sendResponse({ success: false, error: (error as Error)?.message || 'Unknown error' });
        });

      return true;
    }

    if (type === 'redirect-inspector:check-url') {
      startUrlProbe(String(message?.payload?.url ?? ''), forceFinalizeTabChains)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: (error as Error)?.message || 'Unknown error' }));

      return true;
    }

    sendResponse({ ok: false, error: 'Unknown message type' });
    return false;
  }) as any);

  // ---- 301.sh news (opt-in) ----
  setupNews();

  // ---- Manual URL probes: sweep tabs orphaned by an SW restart ----
  setupProbe();
});
