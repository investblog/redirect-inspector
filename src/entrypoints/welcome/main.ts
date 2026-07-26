import { browser } from 'wxt/browser';
import { t } from '../../shared/i18n';
import { sendMessageSafe } from '../../shared/messaging';
import { getNewsEnabled, hasNotificationsPermission, requestNotificationsPermission } from '../../shared/news';
import { initTheme } from '../../shared/theme';

initTheme();

// ---- i18n hydration ----
document.title = t('welcomeTitle');

for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
  const key = el.dataset.i18n!;
  const msg = t(key);
  if (msg && msg !== key) {
    el.textContent = msg;
  }
}
for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
  const key = el.dataset.i18nTitle!;
  const msg = t(key);
  if (msg && msg !== key) {
    el.title = msg;
    el.setAttribute('aria-label', msg);
  }
}

// ---- Version ----
const versionEl = document.getElementById('version');
if (versionEl) {
  versionEl.textContent = `v${browser.runtime.getManifest().version}`;
}

// ---- News opt-in ----
const newsBtn = document.getElementById('news-enable');
const newsStatus = document.getElementById('news-status');

function showNewsEnabled(): void {
  if (newsBtn) newsBtn.hidden = true;
  if (newsStatus) newsStatus.hidden = false;
}

void (async () => {
  if ((await getNewsEnabled()) && (await hasNotificationsPermission())) {
    showNewsEnabled();
  }
})();

newsBtn?.addEventListener('click', async () => {
  const granted = await requestNotificationsPermission();
  if (!granted) return;

  const response = await sendMessageSafe<{ success: boolean }>({
    type: 'redirect-inspector:set-news-enabled',
    payload: { enabled: true },
  });
  if (response?.success) {
    showNewsEnabled();
  } else {
    // Don't hold a granted-but-unused permission if enabling failed.
    browser.permissions.remove({ permissions: ['notifications'] }).catch(() => {});
  }
});

// ---- CTA ----
const ctaBtn = document.getElementById('cta');
ctaBtn?.addEventListener('click', async () => {
  try {
    await (browser.action as any).openPopup();
  } catch {
    // openPopup() may not be available (Firefox, or called outside user gesture).
    // Close the welcome tab instead — the user can click the toolbar icon.
    window.close();
  }
});
