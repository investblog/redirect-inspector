/**
 * Unified Popup / Side Panel — Redirect Inspector
 * Single entrypoint that serves both popup and side panel modes.
 */

import { browser } from 'wxt/browser';
import { analyzeChain } from '../../shared/analysis/heuristics';
import { sendMessageSafe } from '../../shared/messaging';
import { getStoreInfo } from '../../shared/store-links';
import { getTheme, initTheme, toggleTheme } from '../../shared/theme';
import type { Classification, RedirectEvent, RedirectRecord } from '../../shared/types/redirect';
import { createAnalysisDrawer } from './components/analysis-drawer';

// ---- Mode detection ----

const isSidepanel = new URLSearchParams(window.location.search).has('sidepanel');
if (isSidepanel) document.body.classList.add('sidepanel');

// ---- Popup height constants ----

const POPUP_MIN_HEIGHT = 200;
const POPUP_MAX_HEIGHT = 600;

// ---- Constants ----

const SHOW_NOISE_STORAGE_KEY = 'redirectInspector:showNoiseRequests';
const REDIRECT_LOG_KEY = 'redirectLog';
const NOISE_CLASSIFICATIONS = new Set<Classification>(['likely-tracking', 'likely-media']);

// ---- State ----

let allRedirectRecords: RedirectRecord[] = [];
let storageListenerRegistered = false;

// ---- DOM refs (set by buildUI) ----

let statusEl: HTMLElement;
let redirectListEl: HTMLElement;
let showNoiseToggle: HTMLInputElement | null = null;
let noiseSummaryEl: HTMLElement | null = null;
let themeToggleBtn: HTMLButtonElement | null = null;
let popupBody: HTMLElement | null = null;
let popupControls: HTMLElement | null = null;
let countEl: HTMLElement | null = null;

const template = document.getElementById('redirect-item-template') as HTMLTemplateElement;

// ---- Build UI ----

function buildUI(): void {
  const app = document.getElementById('app')!;
  const browserName = (import.meta as any).env?.BROWSER || 'chrome';

  // -- Header --
  const header = document.createElement('header');
  header.className = 'popup__header';

  const headerLeft = document.createElement('div');
  headerLeft.className = 'popup__header-left';

  const brandLink = document.createElement('a');
  brandLink.href = `https://301.st/?utm_source=${browserName}_ext&utm_medium=popup_logo&utm_campaign=redirect_inspector`;
  brandLink.className = 'brand-icon';
  brandLink.target = '_blank';
  brandLink.rel = 'noreferrer';
  brandLink.setAttribute('aria-label', 'Open 301.st');
  brandLink.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#5E8BFF" d="M24.545 34.284c-.025 1.893-.137 3.778-.81 5.585-1.257 3.376-3.697 5.359-7.185 6.063-.94.19-1.92.261-2.881.27-4.467.044-8.934.045-13.4.062H0V36.196h.395c4.1.019 8.2.03 12.3.005a7.3 7.3 0 0 0 1.952-.295c1.318-.384 2.187-1.488 2.251-2.855.065-1.376.098-2.758.06-4.135-.054-1.902-1.42-3.26-3.323-3.328-1.578-.056-3.158-.059-4.737-.064-2.835-.01-5.67-.003-8.505-.016H0V17.54h.361c3.885 0 7.77.01 11.655-.013a5.3 5.3 0 0 0 1.694-.284c1.121-.391 1.808-1.496 1.82-2.768.006-.706.002-1.411 0-2.117-.004-1.62-1.098-2.722-2.708-2.723L.441 9.634H.063V1.729H.38c5.691.02 11.382.013 17.073.025 1.18.003 2.369.054 3.434.648 1.257.7 2.06 1.763 2.137 3.216.09 1.693.071 3.39.074 5.086a69 69 0 0 1-.068 3.57c-.082 1.637-.5 3.177-1.567 4.47-.872 1.057-1.954 1.806-3.31 2.115-.019.003-.032.026-.078.066.164.034.309.057.449.092 2.944.745 4.866 2.532 5.51 5.54a23 23 0 0 1 .442 3.367c.087 1.45.088 2.906.07 4.36m15.546.094c-.005 1.872-.258 3.712-1.102 5.414-1.589 3.201-4.16 5.182-7.584 6.089-1.564.413-3.16.415-4.781.37V38.71c.49-.035.975-.049 1.455-.108 2.041-.25 3.36-1.432 4.133-3.286.512-1.23.73-2.537.757-3.855.07-3.396.097-6.793.117-10.19.01-1.565-.008-3.131-.064-4.694-.055-1.477-.236-2.938-.806-4.326-.796-1.936-2.318-2.984-4.407-3.006-.79-.008-1.581-.001-2.387-.001v-7.48c.033-.013.062-.035.09-.035 1.432.02 2.87-.042 4.295.08 2.542.22 4.785 1.208 6.669 2.956 1.84 1.707 2.991 3.808 3.427 6.285.122.698.192 1.416.193 2.125q.018 10.834-.005 21.669zM48 1.772V46.24c-.1.007-.19.018-.28.018q-2.136.006-4.268.002c-.177 0-.357-.023-.529-.062-.316-.074-.522-.277-.571-.6-.032-.207-.03-.42-.03-.63-.002-14.015 0-28.03-.012-42.046 0-.813.342-1.142 1.144-1.146 1.159-.007 2.318-.003 3.477-.004z"/></svg>`;
  headerLeft.appendChild(brandLink);

  const title = document.createElement('h1');
  title.className = 'popup__title';
  title.textContent = 'Redirect Inspector';
  headerLeft.appendChild(title);

  const headerActions = document.createElement('div');
  headerActions.className = 'popup__header-actions';

  // Pin to side panel button (only in popup mode)
  if (!isSidepanel) {
    const hasSidePanel = !!(browser as any).sidePanel || !!(browser as any).sidebarAction;
    if (hasSidePanel) {
      const pinBtn = document.createElement('button');
      pinBtn.className = 'pin-btn';
      pinBtn.type = 'button';
      pinBtn.title = 'Pin to side panel';
      pinBtn.setAttribute('aria-label', 'Pin to side panel');
      pinBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>`;
      pinBtn.addEventListener('click', openSidePanel);
      headerActions.appendChild(pinBtn);
    }
  }

  // Clear button
  const clearBtn = document.createElement('button');
  clearBtn.id = 'clear-log';
  clearBtn.className = 'btn btn--primary';
  clearBtn.type = 'button';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', clearRedirectLog);
  headerActions.appendChild(clearBtn);

  // Theme toggle
  themeToggleBtn = document.createElement('button');
  themeToggleBtn.id = 'theme-toggle';
  themeToggleBtn.className = 'theme-toggle';
  themeToggleBtn.type = 'button';
  themeToggleBtn.title = 'Toggle theme';
  themeToggleBtn.setAttribute('aria-label', 'Toggle theme');
  themeToggleBtn.addEventListener('click', () => {
    toggleTheme();
    updateThemeIcon();
  });
  headerActions.appendChild(themeToggleBtn);

  header.appendChild(headerLeft);
  header.appendChild(headerActions);
  app.appendChild(header);

  // -- Controls --
  popupControls = document.createElement('div');
  popupControls.className = 'popup__controls';

  const controls = document.createElement('section');
  controls.className = 'controls';

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'controls__toggle';

  showNoiseToggle = document.createElement('input');
  showNoiseToggle.id = 'show-noise';
  showNoiseToggle.type = 'checkbox';
  showNoiseToggle.addEventListener('change', handleShowNoiseChange);

  const toggleText = document.createElement('span');
  toggleText.textContent = 'Show pixel, analytics & media requests';

  toggleLabel.appendChild(showNoiseToggle);
  toggleLabel.appendChild(toggleText);
  controls.appendChild(toggleLabel);

  noiseSummaryEl = document.createElement('span');
  noiseSummaryEl.id = 'noise-summary';
  noiseSummaryEl.className = 'controls__summary';
  noiseSummaryEl.hidden = true;
  controls.appendChild(noiseSummaryEl);

  popupControls.appendChild(controls);
  app.appendChild(popupControls);

  // -- Body --
  popupBody = document.createElement('div');
  popupBody.className = 'popup__body';

  statusEl = document.createElement('section');
  statusEl.id = 'status';
  statusEl.hidden = true;
  popupBody.appendChild(statusEl);

  redirectListEl = document.createElement('section');
  redirectListEl.id = 'redirect-list';
  redirectListEl.className = 'redirect-list';
  popupBody.appendChild(redirectListEl);

  app.appendChild(popupBody);

  // -- Footer --
  const footer = document.createElement('div');
  footer.className = 'popup__footer';

  const storeInfo = getStoreInfo();
  if (storeInfo) {
    const reviewLink = document.createElement('a');
    reviewLink.id = 'review-link';
    reviewLink.className = 'popup__review';
    reviewLink.href = storeInfo.url;
    reviewLink.target = '_blank';
    reviewLink.rel = 'noreferrer';
    reviewLink.title = `Rate on ${storeInfo.label}`;
    const storeIcon = document.createElement('img');
    storeIcon.src = storeInfo.icon;
    storeIcon.width = 14;
    storeIcon.height = 14;
    storeIcon.alt = '';
    storeIcon.className = 'popup__review-icon';
    reviewLink.appendChild(storeIcon);
    reviewLink.appendChild(document.createTextNode('Rate us'));
    footer.appendChild(reviewLink);
  } else {
    footer.appendChild(document.createElement('span'));
  }

  countEl = document.createElement('span');
  countEl.className = 'popup__count';
  footer.appendChild(countEl);

  app.appendChild(footer);
}

// ---- Popup height ----

function hasOpenOverlay(): boolean {
  return !!document.querySelector('.drawer');
}

function updatePopupHeight(): void {
  if (isSidepanel) return;

  requestAnimationFrame(() => {
    if (hasOpenOverlay()) {
      document.body.style.height = `${POPUP_MAX_HEIGHT}px`;
      return;
    }

    const header = document.querySelector('.popup__header') as HTMLElement | null;
    const controls = document.querySelector('.popup__controls') as HTMLElement | null;
    const footer = document.querySelector('.popup__footer') as HTMLElement | null;

    const chromeH = (header?.offsetHeight ?? 0) + (controls?.offsetHeight ?? 0) + (footer?.offsetHeight ?? 0);
    const contentH = popupBody?.scrollHeight ?? 0;
    const needed = chromeH + contentH;

    const height = Math.min(POPUP_MAX_HEIGHT, Math.max(POPUP_MIN_HEIGHT, needed));
    document.body.style.height = `${height}px`;
  });
}

// ---- Open side panel ----

async function openSidePanel(): Promise<void> {
  try {
    if ((browser as any).sidebarAction?.open) {
      await (browser as any).sidebarAction.open();
      window.close();
      return;
    }

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

    browser.tabs.create({ url: browser.runtime.getURL('/popup.html?sidepanel=1') });
  } catch (error) {
    console.error('Failed to open side panel:', error);
    browser.tabs.create({ url: browser.runtime.getURL('/popup.html?sidepanel=1') });
  }
}

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
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '5');
    svg.appendChild(circle);
    const rays = [
      [12, 1, 12, 3],
      [12, 21, 12, 23],
      [4.22, 4.22, 5.64, 5.64],
      [18.36, 18.36, 19.78, 19.78],
      [1, 12, 3, 12],
      [21, 12, 23, 12],
      [4.22, 19.78, 5.64, 18.36],
      [18.36, 5.64, 19.78, 4.22],
    ];
    for (const [x1, y1, x2, y2] of rays) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(x1));
      line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x2));
      line.setAttribute('y2', String(y2));
      svg.appendChild(line);
    }
  }
  themeToggleBtn.appendChild(svg);
}

// ---- Helpers ----

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch {
    return '';
  }
}

function showStatus(message: string, type: string = 'info'): void {
  statusEl.textContent = message;
  statusEl.dataset.type = type;
  statusEl.hidden = !message;
}

function formatUrl(url: string | undefined): string {
  if (!url) return 'Unknown URL';
  try {
    const parsed = new URL(url);
    const path =
      parsed.pathname.endsWith('/') && parsed.pathname !== '/' ? parsed.pathname.slice(0, -1) : parsed.pathname;
    const formattedPath = path === '' ? '/' : path;
    return `${parsed.origin}${formattedPath}${parsed.search}`;
  } catch {
    return url;
  }
}

function formatUrlSafe(raw: string | undefined): string {
  if (!raw) return 'Unknown URL';
  try {
    const u = new URL(raw);
    const path = u.pathname.endsWith('/') && u.pathname !== '/' ? u.pathname.slice(0, -1) : u.pathname;
    return `${u.origin}${path === '' ? '/' : path}${u.search}`;
  } catch {
    return raw;
  }
}

function getHost(raw: string | undefined): string {
  try {
    return new URL(raw!).host;
  } catch {
    return '';
  }
}

function describeHops(count: number): string {
  if (count === 0) return 'No hops recorded';
  if (count === 1) return '1 hop';
  return `${count} hops`;
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

// ---- Records merge ----

function recordTimestamp(record: RedirectRecord): number {
  if (record.initiatedAt) {
    const t = new Date(record.initiatedAt).getTime();
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

function updateRecordsFromResponse(
  persistentRecords: RedirectRecord[] = [],
  pendingRecords: RedirectRecord[] = [],
): void {
  const safePending = Array.isArray(pendingRecords) ? pendingRecords : [];
  const safePersistent = Array.isArray(persistentRecords) ? persistentRecords : [];

  const seen = new Set<string>();
  const merged: RedirectRecord[] = [];

  const pendingById = new Map<string, RedirectRecord>();
  for (const record of safePending) {
    if (!record) continue;
    const id = record.id || record.requestId;
    if (id) pendingById.set(id, record);
  }

  for (const record of safePersistent) {
    if (!record) continue;
    const id = record.id || record.requestId;
    if (id && seen.has(id)) continue;
    if (id) {
      seen.add(id);
      pendingById.delete(id);
    }
    merged.push(record);
  }

  for (const record of pendingById.values()) {
    const id = record.id || record.requestId;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    merged.push(record);
  }

  // Newest first — sort by initiation time descending
  merged.sort((a, b) => recordTimestamp(b) - recordTimestamp(a));

  allRedirectRecords = merged;
  const context = applyFilters(allRedirectRecords);
  updateStatusForRecords(context);
  updateFooterCount();
  updatePopupHeight();
}

// ---- Footer count ----

function updateFooterCount(): void {
  if (!countEl) return;
  const count = allRedirectRecords.length;
  if (count === 0) {
    countEl.textContent = '';
    return;
  }
  countEl.textContent = `${count} chain${count === 1 ? '' : 's'}`;
}

// ---- Noise helpers ----

function updateNoiseSummary(
  _totalRecords: number,
  _visibleRecords: number,
  showingNoise: boolean,
  hiddenRecords: RedirectRecord[] = [],
): void {
  if (!noiseSummaryEl) return;

  const hiddenCount = Array.isArray(hiddenRecords) ? hiddenRecords.length : 0;

  if (showingNoise || hiddenCount <= 0) {
    noiseSummaryEl.hidden = true;
    noiseSummaryEl.textContent = '';
    noiseSummaryEl.title = '';
    return;
  }

  noiseSummaryEl.hidden = false;

  const mediaHidden = hiddenRecords.filter((record) => record?.classification === 'likely-media').length;
  const trackingHidden = hiddenRecords.filter((record) => record?.classification === 'likely-tracking').length;

  let label: string;
  if (trackingHidden > 0 && mediaHidden > 0) {
    label = 'pixel/analytics & media requests';
  } else if (mediaHidden > 0) {
    label = mediaHidden === 1 ? 'media request' : 'media requests';
  } else {
    label = trackingHidden === 1 ? 'pixel/analytics request' : 'pixel/analytics requests';
  }

  noiseSummaryEl.textContent = `${hiddenCount} hidden`;
  noiseSummaryEl.title = `${hiddenCount} ${label} hidden`;
}

// ---- Filtering ----

interface FilterContext {
  total: number;
  visible: number;
  hidden: number;
  showingNoise: boolean;
}

function applyFilters(records: RedirectRecord[]): FilterContext {
  const safeRecords = Array.isArray(records) ? records : [];
  const showingNoise = Boolean(showNoiseToggle?.checked);
  const filtered = showingNoise
    ? safeRecords
    : safeRecords.filter((record) => !NOISE_CLASSIFICATIONS.has(record.classification!));
  const hiddenRecords = showingNoise
    ? []
    : safeRecords.filter((record) => NOISE_CLASSIFICATIONS.has(record.classification!));

  renderRedirectLog(filtered);
  updateNoiseSummary(safeRecords.length, filtered.length, showingNoise, hiddenRecords);

  return {
    total: safeRecords.length,
    visible: filtered.length,
    hidden: hiddenRecords.length,
    showingNoise,
  };
}

function updateStatusForRecords({ total, visible, hidden, showingNoise }: FilterContext): void {
  if (total === 0) {
    showStatus('No redirect chains captured yet. Navigate to a site that triggers a redirect.', 'info');
    return;
  }

  if (!showingNoise && visible === 0 && hidden > 0) {
    showStatus(
      'Only pixel/analytics/media requests were captured. Enable "Show pixel, analytics & media requests" to inspect them.',
      'info',
    );
    return;
  }

  showStatus('');
}

// ---- Noise preference ----

async function loadNoisePreference(): Promise<boolean> {
  if (!showNoiseToggle) return false;

  try {
    const result = await browser.storage.local.get({ [SHOW_NOISE_STORAGE_KEY]: false });
    const showNoise = Boolean(result[SHOW_NOISE_STORAGE_KEY]);
    showNoiseToggle.checked = showNoise;
    return showNoise;
  } catch (error) {
    console.error('Failed to load pixel noise preference', error);
    showNoiseToggle.checked = false;
    return false;
  }
}

async function handleShowNoiseChange(): Promise<void> {
  if (!showNoiseToggle) return;

  const showNoise = showNoiseToggle.checked;
  try {
    await browser.storage.local.set({ [SHOW_NOISE_STORAGE_KEY]: showNoise });
  } catch (error) {
    console.error('Failed to persist pixel noise preference', error);
  }

  const context = applyFilters(allRedirectRecords);
  updateStatusForRecords(context);
  updatePopupHeight();
}

// ---- Export ----

function normalizeEventsForExport(record: RedirectRecord): RedirectEvent[] {
  return Array.isArray(record?.events) ? record.events : [];
}

function squashClientNoise(events: RedirectEvent[]): RedirectEvent[] {
  if (!Array.isArray(events) || events.length === 0) return events;

  const result: RedirectEvent[] = [];
  const knownHosts = new Set(
    events
      .map((e) => e.to || e.from)
      .filter(Boolean)
      .map((u) => getHost(u))
      .filter(Boolean),
  );

  for (let i = 0; i < events.length; i++) {
    const step = events[i];
    const next = events[i + 1];

    const isClient = step.method === 'CLIENT' || step.type === 'client-redirect' || step.statusCode === 'JS';

    let drop = false;

    if (isClient) {
      const targetHost = getHost(step.to || step.from);
      const nextIsNormal =
        next && !(next.method === 'CLIENT' || next.type === 'client-redirect' || next.statusCode === 'JS');

      if (targetHost && knownHosts.has(targetHost) && nextIsNormal) {
        drop = true;
      }
    }

    if (!drop) {
      result.push(step);
    }
  }

  return result;
}

function formatRedirectChainForExport(record: RedirectRecord): string {
  if (record?.pending) {
    return ['Redirect chain is still in progress.', '', 'Generated by: Redirect Inspector (301.st)'].join('\n');
  }

  const rawEvents = normalizeEventsForExport(record);
  const events = squashClientNoise(rawEvents);

  const compact: RedirectEvent[] = [];
  for (const step of events) {
    const last = compact[compact.length - 1];
    const curHost = getHost(step.to || step.from);
    const lastHost = last ? getHost(last.to || last.from) : null;
    if (last && curHost && lastHost && curHost === lastHost) {
      continue;
    }
    compact.push(step);
  }

  const lines = ['Redirect chain:'];

  if (compact.length === 0) {
    lines.push('No steps recorded.');
  } else {
    compact.forEach((step, index) => {
      const status = step.statusCode ?? '\u2014';
      const destination = formatUrlSafe(step.to || step.from);
      lines.push(`${index + 1}. ${status} \u2192 ${destination}`);
    });
  }

  const finalUrl =
    record?.finalUrl || (compact.length ? compact.at(-1)!.to || compact.at(-1)!.from : null) || record?.initialUrl;

  if (finalUrl) {
    lines.push('', `Final URL: ${formatUrlSafe(finalUrl)}`);
  }

  lines.push('', 'Generated by: Redirect Inspector (301.st)');

  return lines.join('\n');
}

async function copyRedirectChain(record: RedirectRecord, triggerButton: HTMLButtonElement | null): Promise<void> {
  const summary = formatRedirectChainForExport(record);
  try {
    await navigator.clipboard.writeText(summary);
    if (triggerButton) {
      const originalTitle = triggerButton.title;
      triggerButton.title = 'Copied!';
      triggerButton.setAttribute('aria-label', 'Copied!');
      triggerButton.classList.add('redirect-item__copy--success');
      triggerButton.disabled = true;
      setTimeout(() => {
        triggerButton.disabled = false;
        triggerButton.title = originalTitle;
        triggerButton.setAttribute('aria-label', originalTitle);
        triggerButton.classList.remove('redirect-item__copy--success');
      }, 1600);
    }
  } catch (error) {
    console.error('Failed to copy redirect chain', error);
    showStatus('Failed to copy redirect chain to clipboard.', 'error');
  }
}

// ---- Render steps ----

function renderRedirectStep(step: RedirectEvent): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'redirect-step';

  const statusBadge = document.createElement('span');
  statusBadge.className = 'redirect-step__status';
  const statusText = String(step.statusCode ?? '\u2014');
  statusBadge.textContent = statusText;
  statusBadge.dataset.status = statusText;
  li.appendChild(statusBadge);

  const fromHost = document.createElement('span');
  fromHost.className = 'redirect-step__host';
  fromHost.textContent = getHost(step.from) || formatUrl(step.from);
  fromHost.title = step.from || '';
  li.appendChild(fromHost);

  if (step.to) {
    const arrow = document.createElement('span');
    arrow.className = 'redirect-step__arrow';
    arrow.textContent = '\u2192';
    li.appendChild(arrow);

    const toHost = document.createElement('span');
    toHost.className = 'redirect-step__to';
    toHost.textContent = getHost(step.to) || formatUrl(step.to);
    toHost.title = step.to;
    li.appendChild(toHost);
  }

  return li;
}

function normalizeEvents(record: RedirectRecord): RedirectEvent[] {
  if (Array.isArray(record.events) && record.events.length > 0) return record.events;
  return [];
}

// ---- Render item ----

function pickTitleUrl(record: RedirectRecord, events: RedirectEvent[]): string {
  if (record.finalUrl) return record.finalUrl;

  const last = events.at(-1);
  if (last?.to) return last.to;
  if (last?.from) return last.from;

  if (record.initialUrl && last?.to && sameHost(record.initialUrl, last.to)) {
    return record.initialUrl;
  }

  return record.initialUrl || 'Unknown URL';
}

function renderRedirectItem(record: RedirectRecord): DocumentFragment {
  const clone = template.content.cloneNode(true) as DocumentFragment;
  const rootEl = clone.querySelector('.redirect-item') as HTMLElement;

  const events = normalizeEvents(record);

  // ---- Pending items: compact ticker style ----
  if (record.pending) {
    rootEl.classList.add('redirect-item--pending');

    const titleEl = clone.querySelector('.redirect-item__title') as HTMLElement;
    const domain =
      getHost(record.initialUrl) || getHost(events.at(-1)?.to) || getHost(events.at(-1)?.from) || 'Unknown';
    titleEl.textContent = domain;
    titleEl.title = record.initialUrl || '';

    const timestampEl = clone.querySelector('.redirect-item__timestamp') as HTMLElement;
    const time = record.initiatedAt ? formatTime(record.initiatedAt) : '';
    timestampEl.textContent = time;

    // Hide tab and hops for pending
    const tabEl = clone.querySelector('.redirect-item__tab') as HTMLElement;
    tabEl.remove();
    const hopsEl = clone.querySelector('.redirect-item__hops') as HTMLElement;
    hopsEl.remove();

    const metaEl = clone.querySelector('.redirect-item__meta') as HTMLElement;
    const pendingBadge = document.createElement('span');
    pendingBadge.className = 'redirect-item__badge redirect-item__badge--pending';
    pendingBadge.textContent = record.awaitingClientRedirect ? 'Awaiting\u2026' : 'Capturing\u2026';
    metaEl.appendChild(pendingBadge);

    // No steps, no noise, no footer for pending
    const stepsEl = clone.querySelector('.redirect-item__steps') as HTMLElement;
    stepsEl.remove();
    const footerEl = clone.querySelector('.redirect-item__footer') as HTMLElement;
    footerEl.remove();
    const copyButton = clone.querySelector('.redirect-item__copy') as HTMLElement;
    if (copyButton) copyButton.remove();

    return clone;
  }

  // ---- Completed items ----

  const titleEl = clone.querySelector('.redirect-item__title') as HTMLElement;
  const titleUrl = pickTitleUrl(record, events);
  titleEl.textContent = formatUrl(titleUrl);
  titleEl.title = titleUrl;

  const timestampEl = clone.querySelector('.redirect-item__timestamp') as HTMLElement;
  const completedAt = record.completedAt || events.at(-1)?.timestamp || record.initiatedAt;
  timestampEl.textContent = completedAt ? formatTime(completedAt) : '';
  timestampEl.title = completedAt ? new Date(completedAt).toLocaleString() : '';

  // Hide tab ID (rarely useful) — keep hops
  const tabEl = clone.querySelector('.redirect-item__tab') as HTMLElement;
  tabEl.remove();

  const hopsEl = clone.querySelector('.redirect-item__hops') as HTMLElement;
  hopsEl.textContent = describeHops(events.length);

  const metaEl = clone.querySelector('.redirect-item__meta') as HTMLElement;

  // Only show initiator when meaningful (not null/undefined/"null")
  if (record.initiator && record.initiator !== 'null' && record.initiator !== 'undefined') {
    const initiatorEl = document.createElement('span');
    initiatorEl.className = 'redirect-item__initiator';
    initiatorEl.textContent = getHost(record.initiator) || record.initiator;
    initiatorEl.title = record.initiator;
    metaEl.appendChild(initiatorEl);
  }

  if (record.classification === 'likely-tracking') {
    const classificationEl = document.createElement('span');
    classificationEl.className = 'redirect-item__badge';
    classificationEl.textContent = 'Tracking';
    if (record.classificationReason) classificationEl.title = record.classificationReason;
    metaEl.appendChild(classificationEl);
  } else if (record.classification === 'likely-media') {
    const classificationEl = document.createElement('span');
    classificationEl.className = 'redirect-item__badge';
    classificationEl.textContent = 'Media';
    if (record.classificationReason) classificationEl.title = record.classificationReason;
    metaEl.appendChild(classificationEl);
  }

  const stepsEl = clone.querySelector('.redirect-item__steps') as HTMLElement;
  events.forEach((step) => {
    stepsEl.appendChild(renderRedirectStep(step));
  });

  // Analyze button
  const headingEl = clone.querySelector('.redirect-item__heading') as HTMLElement;
  const analyzeBtn = document.createElement('button');
  analyzeBtn.className = 'redirect-item__analyze btn--ghost';
  analyzeBtn.type = 'button';
  analyzeBtn.title = 'Analyze chain';
  analyzeBtn.setAttribute('aria-label', 'Analyze chain');
  analyzeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  analyzeBtn.addEventListener('click', () => {
    const result = analyzeChain(record);
    const drawer = createAnalysisDrawer(record, result, () => {
      updatePopupHeight();
    });
    document.body.appendChild(drawer);
    updatePopupHeight();
  });
  headingEl.insertBefore(analyzeBtn, headingEl.querySelector('.redirect-item__copy'));

  const copyButton = clone.querySelector('.redirect-item__copy') as HTMLButtonElement | null;
  if (copyButton) {
    copyButton.addEventListener('click', () => {
      copyRedirectChain(record, copyButton);
    });
  }

  // Simplified footer: only show errors/warnings, not success
  const footerEl = clone.querySelector('.redirect-item__footer') as HTMLElement;
  if (record.error) {
    footerEl.textContent = `\u2717 ${record.error}`;
    footerEl.dataset.type = 'error';
    footerEl.hidden = false;
  } else if (record.finalStatus) {
    const code = Number(record.finalStatus);
    if (Number.isFinite(code) && code >= 400) {
      footerEl.textContent = `\u2717 ${record.finalStatus}`;
      footerEl.dataset.type = 'error';
      footerEl.hidden = false;
    } else {
      footerEl.remove();
    }
  } else {
    footerEl.remove();
  }

  return clone;
}

// ---- Render list ----

function renderRedirectLog(records: RedirectRecord[]): void {
  redirectListEl.textContent = '';
  records.forEach((record) => {
    redirectListEl.appendChild(renderRedirectItem(record));
  });
}

// ---- Load / Clear ----

async function loadRedirectLogFromStorage(): Promise<void> {
  try {
    const storage = await browser.storage.local.get({ [REDIRECT_LOG_KEY]: [] });
    updateRecordsFromResponse((storage[REDIRECT_LOG_KEY] as RedirectRecord[]) || [], []);
  } catch (error) {
    console.error('Failed to read redirect log from local storage', error);
    showStatus('Failed to load stored redirects.', 'error');
  }
}

function subscribeToLogUpdates(): void {
  if (storageListenerRegistered || !browser?.storage?.onChanged) {
    return;
  }

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }

    if (Object.hasOwn(changes, REDIRECT_LOG_KEY)) {
      fetchRedirectLog().catch((error) => {
        console.error('Failed to refresh redirect log after storage change', error);
      });
    }
  });

  storageListenerRegistered = true;
}

async function fetchRedirectLog(): Promise<void> {
  const response = await sendMessageSafe<{ log: RedirectRecord[]; pending: RedirectRecord[]; error?: string }>({
    type: 'redirect-inspector:get-log',
  });

  if (response && !response.__error && !response.error) {
    const persistent = Array.isArray(response.log) ? response.log : [];
    const pending = Array.isArray(response.pending) ? response.pending : [];
    updateRecordsFromResponse(persistent, pending);
    return;
  }

  console.warn('Background not available / failed, reading local storage\u2026');
  await loadRedirectLogFromStorage();
}

async function clearRedirectLog(): Promise<void> {
  showStatus('Clearing\u2026', 'info');

  const response = await sendMessageSafe<{ success: boolean }>({
    type: 'redirect-inspector:clear-log',
  });

  if (response && !response.__error && response.success) {
    allRedirectRecords = [];
    applyFilters(allRedirectRecords);
    updateFooterCount();
    updatePopupHeight();
    showStatus('Redirect log cleared.', 'success');
    return;
  }

  try {
    await browser.storage.local.set({ [REDIRECT_LOG_KEY]: [] });
    allRedirectRecords = [];
    applyFilters(allRedirectRecords);
    updateFooterCount();
    updatePopupHeight();
    showStatus('Redirect log cleared (local).', 'success');
  } catch (err) {
    const error = err as Error;
    console.error('Local clear failed:', error);
    showStatus(`Failed to clear redirects: ${error.message}`, 'error');
  }
}

// ---- Header scroll (collapse controls on scroll down, show on scroll up) ----

function initHeaderScroll(): void {
  if (!popupBody || !popupControls) return;

  const SCROLL_DELTA = 5;
  let lastScrollTop = 0;

  popupBody.addEventListener(
    'scroll',
    () => {
      const scrollTop = popupBody!.scrollTop;
      const delta = scrollTop - lastScrollTop;

      if (scrollTop <= 0) {
        popupControls!.classList.remove('controls-hidden');
        lastScrollTop = scrollTop;
        return;
      }

      if (Math.abs(delta) < SCROLL_DELTA) return;

      if (delta > 0) {
        popupControls!.classList.add('controls-hidden');
      } else {
        popupControls!.classList.remove('controls-hidden');
      }

      lastScrollTop = scrollTop;
    },
    { passive: true },
  );
}

// ---- Init ----

document.addEventListener('DOMContentLoaded', () => {
  buildUI();
  initTheme();
  updateThemeIcon();
  initHeaderScroll();
  subscribeToLogUpdates();

  (async () => {
    await loadNoisePreference();
    await loadRedirectLogFromStorage();
    await fetchRedirectLog();
  })().catch((error) => {
    console.error('Failed to initialize', error);
    showStatus('Failed to initialize.', 'error');
  });
});
