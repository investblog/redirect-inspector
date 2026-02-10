/**
 * Side Panel — main UI for Redirect Inspector
 * Ported from popup.js with TypeScript types
 */

import { browser } from 'wxt/browser';
import { sendMessageSafe } from '../../shared/messaging';
import { getTheme, initTheme, toggleTheme } from '../../shared/theme';
import type { Classification, RedirectEvent, RedirectRecord } from '../../shared/types/redirect';

// ---- DOM refs ----

const statusEl = document.getElementById('status')!;
const redirectListEl = document.getElementById('redirect-list')!;
const template = document.getElementById('redirect-item-template') as HTMLTemplateElement;
const clearButton = document.getElementById('clear-log')!;
const showNoiseToggle = document.getElementById('show-noise') as HTMLInputElement | null;
const noiseSummaryEl = document.getElementById('noise-summary');
const themeToggleBtn = document.getElementById('theme-toggle');
const panelBody = document.querySelector('.panel__body') as HTMLElement | null;
const panelControls = document.querySelector('.panel__controls') as HTMLElement | null;

// ---- Constants ----

const SHOW_NOISE_STORAGE_KEY = 'redirectInspector:showNoiseRequests';
const REDIRECT_LOG_KEY = 'redirectLog';
const NOISE_CLASSIFICATIONS = new Set<Classification>(['likely-tracking', 'likely-media']);

// ---- State ----

let allRedirectRecords: RedirectRecord[] = [];
let storageListenerRegistered = false;

// ---- Theme icon ----

function updateThemeIcon(): void {
  if (!themeToggleBtn) return;
  const theme = getTheme();
  // Sun icon for light (meaning: click to go dark), Moon for dark
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

// ---- Helpers ----

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

function describeTab(tabId: number | undefined): string {
  return typeof tabId === 'number' && tabId >= 0 ? `Tab ${tabId}` : 'Background';
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

function recordSortWeight(record: RedirectRecord): number {
  if (!record.pending) return 0; // completed — top
  if (record.awaitingClientRedirect) return 2; // awaiting JS redirect — bottom
  return 1; // actively capturing — middle
}

function updateRecordsFromResponse(
  persistentRecords: RedirectRecord[] = [],
  pendingRecords: RedirectRecord[] = [],
): void {
  const safePending = Array.isArray(pendingRecords) ? pendingRecords : [];
  const safePersistent = Array.isArray(persistentRecords) ? persistentRecords : [];

  const seen = new Set<string>();
  const merged: RedirectRecord[] = [];

  // Pending records indexed for dedup (persistent version takes priority)
  const pendingById = new Map<string, RedirectRecord>();
  for (const record of safePending) {
    if (!record) continue;
    const id = record.id || record.requestId;
    if (id) pendingById.set(id, record);
  }

  // Persistent records first (preferred source of truth)
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

  // Remaining pending-only records
  for (const record of pendingById.values()) {
    const id = record.id || record.requestId;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    merged.push(record);
  }

  // Sort: completed → capturing → awaiting (stable sort preserves order within groups)
  merged.sort((a, b) => recordSortWeight(a) - recordSortWeight(b));

  allRedirectRecords = merged;
  const context = applyFilters(allRedirectRecords);
  updateStatusForRecords(context);
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

  const fromCol = document.createElement('div');
  fromCol.className = 'redirect-step__col redirect-step__col--from';

  const statusBadge = document.createElement('span');
  statusBadge.className = 'redirect-step__status';
  const statusText = String(step.statusCode ?? '\u2014');
  statusBadge.textContent = statusText;
  statusBadge.dataset.status = statusText;
  fromCol.appendChild(statusBadge);

  const fromUrlEl = document.createElement('span');
  fromUrlEl.className = 'redirect-step__url';
  fromUrlEl.textContent = formatUrl(step.from);
  fromUrlEl.title = step.from || '';
  fromCol.appendChild(fromUrlEl);

  const midCol = document.createElement('div');
  midCol.className = 'redirect-step__col redirect-step__col--mid';

  const arrowEl = document.createElement('span');
  arrowEl.className = 'redirect-step__arrow';
  arrowEl.textContent = step.method === 'CLIENT' || step.type === 'client-redirect' ? '\u21D4' : '\u2192';
  midCol.appendChild(arrowEl);

  const metaEl = document.createElement('span');
  metaEl.className = 'redirect-step__meta';
  const parts: string[] = [];
  if (step.method && step.method !== 'GET') parts.push(step.method.toUpperCase());
  if (step.type && step.type !== 'main_frame') parts.push(step.type);
  if (step.noise) parts.push(step.noiseReason || 'noise');
  metaEl.textContent = parts.join(' \u2022 ');
  midCol.appendChild(metaEl);

  const toCol = document.createElement('div');
  toCol.className = 'redirect-step__col redirect-step__col--to';

  const toUrlEl = document.createElement('span');
  toUrlEl.className = 'redirect-step__url';
  const toText = step.to ? formatUrl(step.to) : '\u2014';
  toUrlEl.textContent = toText;
  toUrlEl.title = step.to || '';
  toCol.appendChild(toUrlEl);

  li.appendChild(fromCol);
  li.appendChild(midCol);
  li.appendChild(toCol);

  return li;
}

function normalizeEvents(record: RedirectRecord): RedirectEvent[] {
  if (Array.isArray(record.events) && record.events.length > 0) return record.events;

  return [];
}

// ---- Noise section ----

function renderNoiseSection(record: RedirectRecord, containerEl: HTMLElement): void {
  const noiseEvents =
    Array.isArray(record?.noiseEvents) && record.noiseEvents.length
      ? record.noiseEvents
      : normalizeEvents(record).filter((e) => e.noise);
  if (!noiseEvents.length) return;

  const block = document.createElement('div');
  block.className = 'redirect-item__noise';

  const title = document.createElement('div');
  title.className = 'redirect-item__noise-title';
  title.textContent = 'Service / analytics requests:';
  block.appendChild(title);

  noiseEvents.forEach((e) => {
    const row = document.createElement('div');
    row.className = 'redirect-item__noise-row';

    const label =
      e.noiseReason === 'cloudflare-challenge'
        ? 'Cloudflare challenge JS'
        : e.noiseReason === 'analytics'
          ? 'Analytics'
          : 'Service';

    const shortUrl = e.to || e.from || '';
    const displayUrl = shortUrl.length > 140 ? `${shortUrl.slice(0, 140)}\u2026` : shortUrl;

    row.textContent = `${label}: ${displayUrl}`;
    row.title = shortUrl;

    block.appendChild(row);
  });

  containerEl.appendChild(block);
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

  const titleEl = clone.querySelector('.redirect-item__title') as HTMLElement;
  const titleUrl = pickTitleUrl(record, events);
  titleEl.textContent = formatUrl(titleUrl);
  titleEl.title = titleUrl;

  const timestampEl = clone.querySelector('.redirect-item__timestamp') as HTMLElement;
  const completedAt = record.completedAt || events.at(-1)?.timestamp || record.initiatedAt;
  timestampEl.textContent = completedAt ? new Date(completedAt).toLocaleString() : '';

  const tabEl = clone.querySelector('.redirect-item__tab') as HTMLElement;
  tabEl.textContent = describeTab(record.tabId);

  const hopsEl = clone.querySelector('.redirect-item__hops') as HTMLElement;
  hopsEl.textContent = describeHops(events.length);

  const metaEl = clone.querySelector('.redirect-item__meta') as HTMLElement;
  if (record.initiator) {
    const initiatorEl = document.createElement('span');
    initiatorEl.className = 'redirect-item__initiator';
    initiatorEl.textContent = `Initiated by ${record.initiator}`;
    initiatorEl.title = record.initiator;
    metaEl.appendChild(initiatorEl);
  }

  if (record.classification === 'likely-tracking') {
    const classificationEl = document.createElement('span');
    classificationEl.className = 'redirect-item__badge';
    classificationEl.textContent = 'Likely tracking pixel';
    if (record.classificationReason) classificationEl.title = record.classificationReason;
    metaEl.appendChild(classificationEl);
  } else if (record.classification === 'likely-media') {
    const classificationEl = document.createElement('span');
    classificationEl.className = 'redirect-item__badge';
    classificationEl.textContent = 'Likely media request';
    if (record.classificationReason) classificationEl.title = record.classificationReason;
    metaEl.appendChild(classificationEl);
  }

  if (record.pending) {
    rootEl.classList.add('redirect-item--pending');
    const pendingBadge = document.createElement('span');
    pendingBadge.className = 'redirect-item__badge redirect-item__badge--pending';
    pendingBadge.textContent = record.awaitingClientRedirect ? 'Awaiting redirect' : 'Capturing\u2026';
    metaEl.appendChild(pendingBadge);
  }

  const stepsEl = clone.querySelector('.redirect-item__steps') as HTMLElement;
  events.forEach((step) => {
    stepsEl.appendChild(renderRedirectStep(step));
  });

  renderNoiseSection(record, rootEl);

  const copyButton = clone.querySelector('.redirect-item__copy') as HTMLButtonElement | null;
  if (copyButton) {
    if (record.pending) {
      copyButton.disabled = true;
      copyButton.title = 'Redirect is still in progress';
      copyButton.setAttribute('aria-label', 'Redirect is still in progress');
    } else {
      copyButton.addEventListener('click', () => {
        copyRedirectChain(record, copyButton);
      });
    }
  }

  const footerEl = clone.querySelector('.redirect-item__footer') as HTMLElement;
  if (record.pending) {
    let message: string;
    if (record.awaitingClientRedirect) {
      let suffix = '';
      if (typeof record.awaitingClientRedirectDeadline === 'number') {
        const remainingMs = record.awaitingClientRedirectDeadline - Date.now();
        if (Number.isFinite(remainingMs) && remainingMs > 0) {
          const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
          suffix = ` (~${seconds}s left)`;
        }
      }
      message = `Awaiting potential client-side redirect${suffix}\u2026`;
    } else {
      message = 'Redirect chain still in progress\u2026';
    }

    footerEl.textContent = `${message} This view will refresh automatically.`;
    footerEl.dataset.type = 'info';
    footerEl.hidden = false;
  } else if (record.error) {
    footerEl.textContent = `Terminated with error: ${record.error}`;
    footerEl.dataset.type = 'error';
    footerEl.hidden = false;
  } else if (record.finalStatus) {
    footerEl.textContent = `Completed with status ${record.finalStatus}`;
    const code = Number(record.finalStatus);
    if (Number.isFinite(code)) {
      if (code >= 200 && code < 300) footerEl.dataset.type = 'success';
      else if (code >= 400) footerEl.dataset.type = 'error';
      else footerEl.dataset.type = 'warning';
    }
    footerEl.hidden = false;
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
    showStatus('Redirect log cleared.', 'success');
    return;
  }

  try {
    await browser.storage.local.set({ [REDIRECT_LOG_KEY]: [] });
    allRedirectRecords = [];
    applyFilters(allRedirectRecords);
    showStatus('Redirect log cleared (local).', 'success');
  } catch (err) {
    const error = err as Error;
    console.error('Local clear failed:', error);
    showStatus(`Failed to clear redirects: ${error.message}`, 'error');
  }
}

// ---- Header scroll (collapse controls on scroll down, show on scroll up) ----

function initHeaderScroll(): void {
  if (!panelBody || !panelControls) return;

  const SCROLL_DELTA = 5;
  let lastScrollTop = 0;

  panelBody.addEventListener(
    'scroll',
    () => {
      const scrollTop = panelBody.scrollTop;
      const delta = scrollTop - lastScrollTop;

      if (scrollTop <= 0) {
        // At top — always show controls
        panelControls.classList.remove('controls-hidden');
        lastScrollTop = scrollTop;
        return;
      }

      if (Math.abs(delta) < SCROLL_DELTA) return;

      if (delta > 0) {
        // Scrolling down — hide controls
        panelControls.classList.add('controls-hidden');
      } else {
        // Scrolling up — show controls
        panelControls.classList.remove('controls-hidden');
      }

      lastScrollTop = scrollTop;
    },
    { passive: true },
  );
}

// ---- Init ----

clearButton.addEventListener('click', clearRedirectLog);

if (showNoiseToggle) {
  showNoiseToggle.addEventListener('change', handleShowNoiseChange);
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    toggleTheme();
    updateThemeIcon();
  });
}

function patchBrandLinks(): void {
  const browserName = (import.meta as any).env?.BROWSER || 'chrome';
  document.querySelectorAll<HTMLAnchorElement>('.brand-icon').forEach((a) => {
    a.href = a.href.replace('chrome_ext', `${browserName}_ext`);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  updateThemeIcon();
  patchBrandLinks();
  initHeaderScroll();
  subscribeToLogUpdates();

  (async () => {
    await loadNoisePreference();
    await loadRedirectLogFromStorage();
    await fetchRedirectLog();
  })().catch((error) => {
    console.error('Failed to initialize side panel', error);
    showStatus('Failed to initialize side panel', 'error');
  });
});
