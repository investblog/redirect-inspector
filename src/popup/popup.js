const statusEl = document.getElementById('status');
const redirectListEl = document.getElementById('redirect-list');
const template = document.getElementById('redirect-item-template');
const clearButton = document.getElementById('clear-log');

function showStatus(message, type = 'info') {
  statusEl.textContent = message;
  statusEl.dataset.type = type;
  statusEl.hidden = !message;
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

  if (record.initiator) {
    const metaEl = clone.querySelector('.redirect-item__meta');
    const initiatorEl = document.createElement('span');
    initiatorEl.className = 'redirect-item__initiator';
    initiatorEl.textContent = `Initiated by ${record.initiator}`;
    initiatorEl.title = record.initiator;
    metaEl.appendChild(initiatorEl);
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
  try {
    const response = await chrome.runtime.sendMessage({ type: 'redirect-inspector:get-log' });
    if (response?.error) {
      throw new Error(response.error);
    }
    const log = response?.log ?? [];
    renderRedirectLog(log);
    if (log.length === 0) {
      showStatus('No redirect chains captured yet. Navigate to a site that triggers a redirect.', 'info');
    } else {
      showStatus('');
    }
  } catch (error) {
    console.error(error);
    showStatus(`Failed to load redirects: ${error.message}`, 'error');
  }
}

async function clearRedirectLog() {
  showStatus('Clearing…', 'info');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'redirect-inspector:clear-log' });
    if (!response?.success) {
      throw new Error(response?.error || 'Unknown error');
    }
    renderRedirectLog([]);
    showStatus('Redirect log cleared.', 'success');
  } catch (error) {
    console.error(error);
    showStatus(`Failed to clear redirects: ${error.message}`, 'error');
  }
}

clearButton.addEventListener('click', clearRedirectLog);

document.addEventListener('DOMContentLoaded', fetchRedirectLog);
