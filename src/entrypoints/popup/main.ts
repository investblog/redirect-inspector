/**
 * Mini Popup — entry point for Redirect Inspector
 * Shows status + "Open Panel" + "Clear Log"
 */

import { browser } from 'wxt/browser';
import { sendMessageSafe } from '../../shared/messaging';
import { getTheme, initTheme, toggleTheme } from '../../shared/theme';
import type { RedirectRecord } from '../../shared/types/redirect';

// ---- DOM refs ----

const statusEl = document.getElementById('status')!;
const openPanelBtn = document.getElementById('open-panel')!;
const clearLogBtn = document.getElementById('clear-log')!;
const themeToggleBtn = document.getElementById('theme-toggle');

// ---- Theme icon ----

function updateThemeIcon(): void {
  if (!themeToggleBtn) return;
  const theme = getTheme();
  const isSun = theme === 'light';
  themeToggleBtn.textContent = '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (isSun) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z');
    svg.appendChild(path);
  } else {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '5');
    svg.appendChild(circle);
    const rays = [[12,1,12,3],[12,21,12,23],[4.22,4.22,5.64,5.64],[18.36,18.36,19.78,19.78],[1,12,3,12],[21,12,23,12],[4.22,19.78,5.64,18.36],[18.36,5.64,19.78,4.22]];
    for (const [x1,y1,x2,y2] of rays) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(x1)); line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x2)); line.setAttribute('y2', String(y2));
      svg.appendChild(line);
    }
  }
  themeToggleBtn.appendChild(svg);
}

// ---- Status ----

function updateStatus(logCount: number, pendingCount: number): void {
  if (logCount === 0 && pendingCount === 0) {
    statusEl.textContent = 'No redirect chains captured yet.';
    return;
  }

  const parts: string[] = [];
  if (logCount > 0) {
    parts.push(`${logCount} redirect chain${logCount === 1 ? '' : 's'}`);
  }
  if (pendingCount > 0) {
    parts.push(`${pendingCount} in progress`);
  }

  statusEl.textContent = parts.join(', ');
}

// ---- Actions ----

async function openSidePanel(): Promise<void> {
  try {
    // Firefox: sidebarAction.open() must be called from popup (user gesture context)
    if ((browser as any).sidebarAction?.open) {
      await (browser as any).sidebarAction.open();
      window.close();
      return;
    }

    // Chrome: sidePanel.open() requires user gesture — call directly from popup
    if ((browser as any).sidePanel) {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await (browser as any).sidePanel.open({ tabId: tab.id });
      } else {
        const currentWindow = await browser.windows.getCurrent();
        await (browser as any).sidePanel.open({ windowId: currentWindow.id });
      }
      window.close();
      return;
    }

    // Last resort: open sidepanel in tab
    browser.tabs.create({ url: browser.runtime.getURL('/sidepanel.html') });
  } catch (error) {
    console.error('Failed to open side panel:', error);
    browser.tabs.create({ url: browser.runtime.getURL('/sidepanel.html') });
  }
}

async function clearLog(): Promise<void> {
  clearLogBtn.textContent = 'Clearing...';
  (clearLogBtn as HTMLButtonElement).disabled = true;

  const response = await sendMessageSafe<{ success: boolean }>({
    type: 'redirect-inspector:clear-log',
  });

  if (response && !response.__error && response.success) {
    updateStatus(0, 0);
    clearLogBtn.textContent = 'Cleared!';
    setTimeout(() => {
      clearLogBtn.textContent = 'Clear Log';
      (clearLogBtn as HTMLButtonElement).disabled = false;
    }, 1200);
    return;
  }

  // Fallback: clear local storage
  try {
    await browser.storage.local.set({ redirectLog: [] });
    updateStatus(0, 0);
    clearLogBtn.textContent = 'Cleared!';
  } catch {
    clearLogBtn.textContent = 'Failed';
  }

  setTimeout(() => {
    clearLogBtn.textContent = 'Clear Log';
    (clearLogBtn as HTMLButtonElement).disabled = false;
  }, 1200);
}

// ---- Load status ----

async function loadStatus(): Promise<void> {
  const response = await sendMessageSafe<{
    log: RedirectRecord[];
    pending: RedirectRecord[];
    error?: string;
  }>({ type: 'redirect-inspector:get-log' });

  if (response && !response.__error && !response.error) {
    const logCount = Array.isArray(response.log) ? response.log.length : 0;
    const pendingCount = Array.isArray(response.pending) ? response.pending.length : 0;
    updateStatus(logCount, pendingCount);
    return;
  }

  // Fallback
  try {
    const storage = await browser.storage.local.get({ redirectLog: [] });
    const log = Array.isArray(storage.redirectLog) ? storage.redirectLog : [];
    updateStatus(log.length, 0);
  } catch {
    statusEl.textContent = 'Unable to load status.';
  }
}

// ---- Init ----

openPanelBtn.addEventListener('click', openSidePanel);
clearLogBtn.addEventListener('click', clearLog);

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    toggleTheme();
    updateThemeIcon();
  });
}

const STORE_LINKS: Record<string, { url: string; title: string }> = {
  chrome: {
    url: 'https://chromewebstore.google.com/detail/redirect-inspector/jkeijlkbgkdnhmejgofbbapdbhjljdgg/reviews',
    title: 'Rate Redirect Inspector on Chrome Web Store',
  },
  edge: {
    url: 'https://microsoftedge.microsoft.com/addons/detail/ckblhiaefgkhpgilekhcpapnkpihdlaa',
    title: 'Rate Redirect Inspector on Edge Add-ons',
  },
};

function patchBrandLinks(): void {
  const browserName = (import.meta as any).env?.BROWSER || 'chrome';
  document.querySelectorAll<HTMLAnchorElement>('.brand-icon').forEach((a) => {
    a.href = a.href.replace('chrome_ext', `${browserName}_ext`);
  });

  const reviewLink = document.getElementById('review-link') as HTMLAnchorElement | null;
  const store = STORE_LINKS[browserName];

  if (reviewLink && store) {
    reviewLink.href = store.url;
    reviewLink.title = store.title;
  } else if (reviewLink) {
    // No store link for this browser (e.g. Firefox)
    reviewLink.remove();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  updateThemeIcon();
  patchBrandLinks();
  loadStatus().catch((error) => {
    console.error('Failed to load popup status', error);
    statusEl.textContent = 'Error loading status.';
  });
});
