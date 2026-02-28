import { browser } from 'wxt/browser';
import { initTheme } from '../../shared/theme';

initTheme();

const versionEl = document.getElementById('version');
if (versionEl) {
  versionEl.textContent = `v${browser.runtime.getManifest().version}`;
}

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
