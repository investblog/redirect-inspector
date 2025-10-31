// src/popup/popup.js

const statusEl = document.getElementById('status');
const redirectListEl = document.getElementById('redirect-list');
const template = document.getElementById('redirect-item-template');
const clearButton = document.getElementById('clear-log');
const showNoiseToggle = document.getElementById('show-noise');
const noiseSummaryEl = document.getElementById('noise-summary');

const SHOW_NOISE_STORAGE_KEY = 'redirectInspector:showNoiseRequests';
const REDIRECT_LOG_KEY = 'redirectLog';

let allRedirectRecords = [];

// ===================================================================
//  ЕДИНЫЙ СПИСОК СЕРВИСНЫХ / ШУМНЫХ ХОСТОВ И ПУТЕЙ
//  (должен совпадать с background/service-worker.js)
// ===================================================================
const NOISY_HOSTS = [
  'cloudflareinsights.com',
  'cf-ns.com',
  'cdn.cloudflare.net',
  'www.googletagmanager.com',
  'googletagmanager.com',
  'www.google-analytics.com',
  'google-analytics.com',
  'stats.g.doubleclick.net',
  'connect.facebook.net',
  'graph.facebook.com',
  'www.facebook.com',
  'mc.yandex.ru',
  'yastatic.net',
  'yandex.ru',
  'safeframe.yastatic.net',
  'vk.com',
  'api.vk.com',
  'id.vk.com',
  'auth.mail.ru',
  'doubleclick.net',
  'ads.pubmatic.com',
  'strm.yandex.net'
];

const NOISY_PATH_PARTS = [
  '/cdn-cgi/challenge-platform/',
  '/cdn-cgi/challenge/',
  '/cdn-cgi/bm/',
  '/cdn-cgi/trace',
  '/cdn-cgi/zaraz/',
  '/cdn-cgi/scripts/',
  '/safeframe-bundles/',
  '/gtm.js',
  '/analytics.js'
];

const NOISY_RESOURCE_TYPES = new Set([
  'media',
  'script',
  'stylesheet',
  'font',
  'imageset',
  'object',
  'other',
  'ping',
  'csp_report',
  'xmlhttprequest'
]);

// -------------------------------------------------------------------
// безопасное сообщение в бэкграунд
// -------------------------------------------------------------------
function sendMessageSafe(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.warn('sendMessageSafe:', err.message);
        resolve({ __error: err.message });
        return;
      }
      resolve(response);
    });
  });
}

function showStatus(message, type = 'info') {
  statusEl.textContent = message;
  statusEl.dataset.type = type;
  statusEl.hidden = !message;
}

// -------------------------------------------------------------------
//   noise helpers
// -------------------------------------------------------------------
function isNoisyUrl(raw) {
  if (!raw) return false;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const host = u.hostname;
  if (NOISY_HOSTS.some((svc) => host === svc || host.endsWith('.' + svc))) {
    return true;
  }
  const path = u.pathname || '';
  if (NOISY_PATH_PARTS.some((part) => path.includes(part))) {
    return true;
  }
  return false;
}

function isNoisyRecord(record) {
  if (!record) return false;

  // если бэкграунд уже пометил
  if (record.classification === 'likely-tracking') {
    return true;
  }

  const events = Array.isArray(record.events) ? record.events : [];
  if (!events.length) return false;

  // все шаги — тех.типы
  const allNoisyType = events.every((e) => e.type && NOISY_RESOURCE_TYPES.has(e.type));
  if (allNoisyType) {
    return true;
  }

  // все урлы — сервисные
  const allNoisyUrl = events.every((e) => {
    const u = e.to || e.from;
    return u && isNoisyUrl(u);
  });
  if (allNoisyUrl) {
    return true;
  }

  return false;
}

function countNoiseEvents(records) {
  if (!Array.isArray(records)) return 0;
  let total = 0;
  for (const r of records) {
    if (Array.isArray(r?.events)) {
      total += r.events.filter((e) => e.noise).length;
    }
  }
  return total;
}

function updateNoiseSummary(totalRecords, visibleRecords, showingNoise) {
  if (!noiseSummaryEl) return;

  const totalNoise = countNoiseEvents(allRedirectRecords);

  if (showingNoise || totalRecords === visibleRecords) {
    noiseSummaryEl.hidden = true;
    noiseSummaryEl.textContent = '';
    return;
  }

  const hidden = totalRecords - visibleRecords;

  noiseSummaryEl.hidden = false;

  if (totalNoise > 0) {
    noiseSummaryEl.textContent =
      totalNoise === 1
        ? '1 service / media / analytics request hidden'
        : `${totalNoise} service / media / analytics requests hidden`;
    return;
  }

  noiseSummaryEl.textContent =
    hidden === 1
      ? '1 service / media / analytics request hidden'
      : `${hidden} service / media / analytics requests hidden`;
}

// -------------------------------------------------------------------
//   фильтрация
// -------------------------------------------------------------------
function applyFilters(records) {
  const safeRecords = Array.isArray(records) ? records : [];
  const showingNoise = Boolean(showNoiseToggle?.checked);

  const filtered = showingNoise ? safeRecords : safeRecords.filter((record) => !isNoisyRecord(record));

  renderRedirectLog(filtered);
  updateNoiseSummary(safeRecords.length, filtered.length, showingNoise);

  return {
    total: safeRecords.length,
    visible: filtered.length,
    hidden: safeRecords.length - filtered.length,
    showingNoise
  };
}

function updateStatusForRecords({ total, visible, hidden, showingNoise }) {
  if (total === 0) {
    showStatus('No redirect chains captured yet. Navigate to a site that triggers a redirect.', 'info');
    return;
  }

  if (!showingNoise && visible === 0 && hidden > 0) {
    showStatus(
      'Only tracking / service requests were captured. Enable "Show pixel & analytics requests" to inspect them.',
      'info'
    );
    return;
  }

  showStatus('');
}

async function loadNoisePreference() {
  if (!showNoiseToggle) return false;

  try {
    const result = await chrome.storage.local.get({ [SHOW_NOISE_STORAGE_KEY]: false });
    const showNoise = Boolean(result[SHOW_NOISE_STORAGE_KEY]);
    showNoiseToggle.checked = showNoise;
    return showNoise;
  } catch (error) {
    console.error('Failed to load pixel noise preference', error);
    showNoiseToggle.checked = false;
    return false;
  }
}

async function handleShowNoiseChange() {
  if (!showNoiseToggle) return;

  const showNoise = showNoiseToggle.checked;
  try {
    await chrome.storage.local.set({ [SHOW_NOISE_STORAGE_KEY]: showNoise });
  } catch (error) {
    console.error('Failed to persist pixel noise preference', error);
  }

  const context = applyFilters(allRedirectRecords);
  updateStatusForRecords(context);
}

// -------------------------------------------------------------------
//   утилиты форматирования
// -------------------------------------------------------------------
function formatUrl(url) {
  if (!url) {
    return 'Unknown URL';
  }

  try {
    const parsed = new URL(url);
    const path =
      parsed.pathname.endsWith('/') && parsed.pathname !== '/' ? parsed.pathname.slice(0, -1) : parsed.pathname;
    const formattedPath = path === '' ? '/' : path;
    return `${parsed.origin}${formattedPath}${parsed.search}`;
  } catch (error) {
    return url;
  }
}

function describeTab(tabId) {
  if (typeof tabId === 'number' && tabId >= 0) {
    return `Tab ${tabId}`;
  }
  return 'Background';
}

function describeHops(count) {
  if (count === 0) return 'No hops recorded';
  if (count === 1) return '1 hop';
  return `${count} hops`;
}

// -------------------------------------------------------------------
//   экспорт / копирование
// -------------------------------------------------------------------
function formatUrlSafe(raw) {
  if (!raw) return 'Unknown URL';
  try {
    const u = new URL(raw);
    const path = u.pathname.endsWith('/') && u.pathname !== '/' ? u.pathname.slice(0, -1) : u.pathname;
    return `${u.origin}${path === '' ? '/' : path}${u.search}`;
  } catch (e) {
    return raw;
  }
}

function getHost(raw) {
  try {
    return new URL(raw).host;
  } catch (e) {
    return '';
  }
}

function normalizeEventsForExport(record) {
  return Array.isArray(record?.events) ? record.events : [];
}

function squashClientNoise(events) {
  if (!Array.isArray(events) || events.length === 0) return events;

  const result = [];
  const knownHosts = new Set(
    events
      .map((e) => e.to || e.from)
      .filter(Boolean)
      .map((u) => getHost(u))
      .filter(Boolean)
  );

  for (let i = 0; i < events.length; i++) {
    const step = events[i];
    const next = events[i + 1];

    const isClient =
      step.method === 'CLIENT' ||
      step.type === 'client-redirect' ||
      step.statusCode === 'JS';

    let drop = false;

    if (isClient) {
      const targetHost = getHost(step.to || step.from);
      const nextIsNormal =
        next &&
        !(next.method === 'CLIENT' || next.type === 'client-redirect' || next.statusCode === 'JS');

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

function formatRedirectChainForExport(record) {
  const rawEvents = normalizeEventsForExport(record);
  const events = squashClientNoise(rawEvents);

  // склеим подряд идущие переходы на один и тот же хост
  const compact = [];
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
      const status = step.statusCode ?? '—';
      const destination = formatUrlSafe(step.to || step.from);
      lines.push(`${index + 1}. ${status} → ${destination}`);
    });
  }

  const finalUrl =
    record?.finalUrl ||
    (compact.length ? compact.at(-1).to || compact.at(-1).from : null) ||
    record?.initialUrl;

  if (finalUrl) {
    lines.push('', `Final URL: ${formatUrlSafe(finalUrl)}`);
  }

  lines.push('', 'Generated by: Redirect Inspector (301.st)');

  return lines.join('\n');
}

async function copyRedirectChain(record, triggerButton) {
  const summary = formatRedirectChainForExport(record);

  try {
    if (!navigator?.clipboard?.writeText) {
      throw new Error('Clipboard API is not available.');
    }

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

// -------------------------------------------------------------------
//   шаги
// -------------------------------------------------------------------
function normalizeEvents(record) {
  if (Array.isArray(record.events) && record.events.length > 0) {
    return record.events;
  }

  if (record.url && record.redirectUrl) {
    return [
      {
        from: record.url,
        to: record.redirectUrl,
        statusCode: record.statusCode,
        method: record.method,
        timestamp: record.timestamp
      }
    ];
  }

  return [];
}

// -------- render steps --------
function renderRedirectStep(step) {
  const li = document.createElement('li');
  li.className = 'redirect-step';

  // from
  const fromCol = document.createElement('div');
  fromCol.className = 'redirect-step__col redirect-step__col--from';

  const statusEl = document.createElement('span');
  statusEl.className = 'redirect-step__status';
  statusEl.textContent = step.statusCode ?? '—';
  fromCol.appendChild(statusEl);

  const fromUrlEl = document.createElement('span');
  fromUrlEl.className = 'redirect-step__url';
  fromUrlEl.textContent = formatUrl(step.from);
  fromUrlEl.title = step.from || '';
  fromCol.appendChild(fromUrlEl);

  // middle
  const midCol = document.createElement('div');
  midCol.className = 'redirect-step__col redirect-step__col--mid';

  const arrowEl = document.createElement('span');
  arrowEl.className = 'redirect-step__arrow';
  arrowEl.textContent =
    step.method === 'CLIENT' || step.type === 'client-redirect' ? '↔' : '→';
  midCol.appendChild(arrowEl);

  const metaEl = document.createElement('span');
  metaEl.className = 'redirect-step__meta';
  const parts = [];
  if (step.method && step.method !== 'GET') parts.push(step.method.toUpperCase());
  if (step.type && step.type !== 'main_frame') parts.push(step.type);
  if (step.noise) parts.push(step.noiseReason || 'noise');
  metaEl.textContent = parts.join(' • ');
  midCol.appendChild(metaEl);

  // to
  const toCol = document.createElement('div');
  toCol.className = 'redirect-step__col redirect-step__col--to';

  const toUrlEl = document.createElement('span');
  toUrlEl.className = 'redirect-step__url';
  const toText = step.to ? formatUrl(step.to) : '—';
  toUrlEl.textContent = toText;
  toUrlEl.title = step.to || '';
  toCol.appendChild(toUrlEl);

  li.appendChild(fromCol);
  li.appendChild(midCol);
  li.appendChild(toCol);

  return li;
}

// ---- рендер служебных запросов ----
function renderNoiseSection(record, containerEl) {
  const events = normalizeEvents(record);
  const noisy = events.filter((e) => e.noise);

  if (!noisy.length) return;

  const block = document.createElement('div');
  block.className = 'redirect-item__noise';

  const title = document.createElement('div');
  title.className = 'redirect-item__noise-title';
  title.textContent = 'Service / analytics requests:';
  block.appendChild(title);

  noisy.forEach((e) => {
    const row = document.createElement('div');
    row.className = 'redirect-item__noise-row';

    const label =
      e.noiseReason === 'cloudflare-challenge'
        ? 'Cloudflare challenge JS'
        : e.noiseReason === 'analytics'
        ? 'Analytics'
        : 'Service';

    const shortUrl = e.to || e.from || '';
    const displayUrl = shortUrl.length > 140 ? shortUrl.slice(0, 140) + '…' : shortUrl;

    row.textContent = `${label}: ${displayUrl}`;
    row.title = shortUrl;

    block.appendChild(row);
  });

  containerEl.appendChild(block);
}

function renderRedirectItem(record) {
  const clone = template.content.cloneNode(true);

  const titleEl = clone.querySelector('.redirect-item__title');
  const events = normalizeEvents(record);
  const finalUrl = record.finalUrl || events.at(-1)?.to || record.initialUrl;
  titleEl.textContent = formatUrl(finalUrl || record.initialUrl || 'Unknown URL');
  if (finalUrl) {
    titleEl.title = finalUrl;
  }

  const timestampEl = clone.querySelector('.redirect-item__timestamp');
  const completedAt = record.completedAt || events.at(-1)?.timestamp || record.initiatedAt;
  timestampEl.textContent = completedAt ? new Date(completedAt).toLocaleString() : '';

  const tabEl = clone.querySelector('.redirect-item__tab');
  tabEl.textContent = describeTab(record.tabId);

  const hopsEl = clone.querySelector('.redirect-item__hops');
  const hopCount = events.length;
  hopsEl.textContent = describeHops(hopCount);

  const metaEl = clone.querySelector('.redirect-item__meta');

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
    if (record.classificationReason) {
      classificationEl.title = record.classificationReason;
    }
    metaEl.appendChild(classificationEl);
  }

  const stepsEl = clone.querySelector('.redirect-item__steps');
  events.forEach((step) => {
    stepsEl.appendChild(renderRedirectStep(step));
  });

  const rootEl = clone.querySelector('.redirect-item');
  renderNoiseSection(record, rootEl);

  const copyButton = clone.querySelector('.redirect-item__copy');
  if (copyButton) {
    copyButton.addEventListener('click', () => {
      copyRedirectChain(record, copyButton);
    });
  }

  const footerEl = clone.querySelector('.redirect-item__footer');
  if (record.error) {
    footerEl.textContent = `Terminated with error: ${record.error}`;
    footerEl.dataset.type = 'error';
    footerEl.hidden = false;
  } else if (record.finalStatus) {
    footerEl.textContent = `Completed with status ${record.finalStatus}`;

    const statusCode = Number(record.finalStatus);
    if (Number.isFinite(statusCode)) {
      if (statusCode >= 200 && statusCode < 300) {
        footerEl.dataset.type = 'success';
      } else if (statusCode >= 400) {
        footerEl.dataset.type = 'error';
      } else {
        footerEl.dataset.type = 'warning';
      }
    } else {
      delete footerEl.dataset.type;
    }

    footerEl.hidden = false;
  } else {
    footerEl.remove();
  }

  return clone;
}

function renderRedirectLog(records) {
  redirectListEl.innerHTML = '';
  records.forEach((record) => {
    redirectListEl.appendChild(renderRedirectItem(record));
  });
}

// -------------------------------------------------------------------
//   загрузка / очистка
// -------------------------------------------------------------------
async function fetchRedirectLog() {
  showStatus('Loading redirect chains…', 'info');

  const response = await sendMessageSafe({ type: 'redirect-inspector:get-log' });

  if (response && !response.__error && !response.error) {
    allRedirectRecords = Array.isArray(response.log) ? response.log : [];
    const context = applyFilters(allRedirectRecords);
    updateStatusForRecords(context);
    return;
  }

  console.warn('Background not available / failed, reading local storage…');
  try {
    const storage = await chrome.storage.local.get({ [REDIRECT_LOG_KEY]: [] });
    allRedirectRecords = storage[REDIRECT_LOG_KEY] || [];
    const context = applyFilters(allRedirectRecords);
    updateStatusForRecords(context);
  } catch (error) {
    console.error(error);
    showStatus(`Failed to load redirects: ${error.message}`, 'error');
  }
}

async function clearRedirectLog() {
  showStatus('Clearing…', 'info');

  const response = await sendMessageSafe({ type: 'redirect-inspector:clear-log' });

  if (response && !response.__error && response.success) {
    allRedirectRecords = [];
    applyFilters(allRedirectRecords);
    showStatus('Redirect log cleared.', 'success');
    return;
  }

  try {
    await chrome.storage.local.set({ [REDIRECT_LOG_KEY]: [] });
    allRedirectRecords = [];
    applyFilters(allRedirectRecords);
    showStatus('Redirect log cleared (local).', 'success');
  } catch (err) {
    console.error('Local clear failed:', err);
    showStatus(`Failed to clear redirects: ${err.message}`, 'error');
  }
}

// -------------------------------------------------------------------
//   init
// -------------------------------------------------------------------
clearButton.addEventListener('click', clearRedirectLog);

if (showNoiseToggle) {
  showNoiseToggle.addEventListener('change', handleShowNoiseChange);
}

async function initializePopup() {
  await loadNoisePreference();
  updateNoiseSummary(allRedirectRecords.length, allRedirectRecords.length, Boolean(showNoiseToggle?.checked));
  await fetchRedirectLog();
}

document.addEventListener('DOMContentLoaded', () => {
  initializePopup().catch((error) => {
    console.error('Failed to initialize popup', error);
    showStatus('Failed to initialize popup', 'error');
  });
});
