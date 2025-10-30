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

/**
 * Безопасная отправка сообщения в сервис-воркер.
 * Не роняет попап, если воркер не поднялся.
 */
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

function updateNoiseSummary(totalRecords, visibleRecords, showingNoise) {
  if (!noiseSummaryEl) {
    return;
  }

  const hiddenCount = totalRecords - visibleRecords;
  if (showingNoise || hiddenCount <= 0) {
    noiseSummaryEl.hidden = true;
    noiseSummaryEl.textContent = '';
    return;
  }

  noiseSummaryEl.hidden = false;
  noiseSummaryEl.textContent =
    hiddenCount === 1 ? '1 likely tracking request hidden' : `${hiddenCount} likely tracking requests hidden`;
}

function applyFilters(records) {
  const safeRecords = Array.isArray(records) ? records : [];
  const showingNoise = Boolean(showNoiseToggle?.checked);
  const filtered = showingNoise
    ? safeRecords
    : safeRecords.filter((record) => record.classification !== 'likely-tracking');

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
    showStatus('Only tracking pixel requests were captured. Enable "Show pixel & analytics requests" to inspect them.', 'info');
    return;
  }

  showStatus('');
}

async function loadNoisePreference() {
  if (!showNoiseToggle) {
    return false;
  }

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
  if (!showNoiseToggle) {
    return;
  }

  const showNoise = showNoiseToggle.checked;
  try {
    await chrome.storage.local.set({ [SHOW_NOISE_STORAGE_KEY]: showNoise });
  } catch (error) {
    console.error('Failed to persist pixel noise preference', error);
  }

  const context = applyFilters(allRedirectRecords);
  updateStatusForRecords(context);
}

function formatUrl(url) {
  if (!url) {
    return 'Unknown URL';
  }

  try {
    const parsed = new URL(url);
    const path = parsed.pathname.endsWith('/') && parsed.pathname !== '/' ? parsed.pathname.slice(0, -1) : parsed.pathname;
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
  if (count === 0) {
    return 'No hops recorded';
  }

  if (count === 1) {
    return '1 hop';
  }

  return `${count} hops`;
}

function renderRedirectStep(step) {
  const item = document.createElement('li');
  item.className = 'redirect-step';

  const statusEl = document.createElement('span');
  statusEl.className = 'redirect-step__status';
  statusEl.textContent = step.statusCode ?? '—';
  item.appendChild(statusEl);

  const methodEl = document.createElement('span');
  methodEl.className = 'redirect-step__method';
  methodEl.textContent = step.method || 'GET';
  if (step.type) {
    methodEl.title = step.type;
  }
  item.appendChild(methodEl);

  const fromEl = document.createElement('span');
  fromEl.className = 'redirect-step__url';
  fromEl.textContent = formatUrl(step.from);
  fromEl.title = step.from;
  item.appendChild(fromEl);

  const arrowEl = document.createElement('span');
  arrowEl.className = 'redirect-step__arrow';
  arrowEl.textContent = '→';
  item.appendChild(arrowEl);

  const toEl = document.createElement('span');
  toEl.className = 'redirect-step__url';
  toEl.textContent = formatUrl(step.to);
  toEl.title = step.to;
  item.appendChild(toEl);

  return item;
}

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

function renderRedirectItem(record) {
  const clone = template.content.cloneNode(true);

  const titleEl = clone.querySelector('.redirect-item__title');
  const events = normalizeEvents(record);
  const finalUrl = record.finalUrl || events.at(-1)?.to || record.initialUrl;
  titleEl.textContent = formatUrl(finalUrl);
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

  const footerEl = clone.querySelector('.redirect-item__footer');
  if (record.error) {
    footerEl.textContent = `Terminated with error: ${record.error}`;
    footerEl.dataset.type = 'error';
    footerEl.hidden = false;
  } else if (record.finalStatus) {
    footerEl.textContent = `Completed with status ${record.finalStatus}`;
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

async function fetchRedirectLog() {
  showStatus('Loading redirect chains…', 'info');

  // пробуем через фон
  const response = await sendMessageSafe({ type: 'redirect-inspector:get-log' });

  if (response && !response.__error && !response.error) {
    allRedirectRecords = Array.isArray(response.log) ? response.log : [];
    const context = applyFilters(allRedirectRecords);
    updateStatusForRecords(context);
    return;
  }

  // фон не ответил — читаем напрямую из storage
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

  // 1. пробуем через фон
  const response = await sendMessageSafe({ type: 'redirect-inspector:clear-log' });

  if (response && !response.__error && response.success) {
    // фон очистил
    allRedirectRecords = [];
    applyFilters(allRedirectRecords);
    showStatus('Redirect log cleared.', 'success');
    return;
  }

  // 2. фон не ответил → чистим сами
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
