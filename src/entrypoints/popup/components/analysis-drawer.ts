import type { AnalysisResult } from '../../../shared/analysis/types';
import { t, tPlural } from '../../../shared/i18n';
import type { RedirectRecord } from '../../../shared/types/redirect';
import { el, hopEndpointLabels, severityIcon, statusTitle, svgIcon } from '../helpers';

function getHost(url: string | undefined): string {
  try {
    return new URL(url!).host;
  } catch {
    return '';
  }
}

const SEVERITY_SYMBOL: Record<string, string> = { error: '\u2717', warning: '\u26a0', info: '\u2139' };

function formatAnalysisReport(record: RedirectRecord, result: AnalysisResult): string {
  const events = Array.isArray(record.events) ? record.events : [];
  const lines: string[] = [];

  // Header
  lines.push(`Redirect Inspector \u00b7 Chain Analysis`);
  lines.push(result.summary, '');

  // Hops with full URLs
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const ann = result.hopAnnotations[i];
    const status = String(ev.statusCode ?? '\u2014');
    const from = ev.from || '?';
    const to = ev.to || '';
    const route = to ? `${from} \u2192 ${to}` : from;
    const tags = ann?.tags.length ? `  [${ann.tags.join(', ')}]` : '';
    lines.push(`${i + 1}. [${status}] ${route}${tags}`);
  }

  // Issues — compact: icon + title only
  if (result.issues.length > 0) {
    lines.push('');
    for (const issue of result.issues) {
      const sym = SEVERITY_SYMBOL[issue.severity] || '-';
      lines.push(`${sym} ${issue.title}`);
    }
  }

  // Final destination
  const finalUrl = record.finalUrl || events.at(-1)?.to || events.at(-1)?.from || record.initialUrl;
  if (finalUrl || record.finalStatus) {
    lines.push('');
    const status = record.finalStatus ? ` (${record.finalStatus})` : '';
    lines.push(`\u2192 ${finalUrl || '?'}${status}`);
  }

  lines.push('', '\u2014 Redirect Inspector (301.st)');
  return lines.join('\n');
}

export function createAnalysisDrawer(record: RedirectRecord, result: AnalysisResult, onClose: () => void): HTMLElement {
  const drawer = el('aside', 'drawer');
  const restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const close = (): void => {
    document.removeEventListener('keydown', onKeydown);
    drawer.remove();
    restoreFocusTo?.focus();
    onClose();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKeydown);

  // Overlay
  const overlay = el('div', 'drawer__overlay');
  overlay.addEventListener('click', close);
  drawer.appendChild(overlay);

  // Panel
  const panel = el('div', 'drawer__panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', t('drawerTitle'));
  panel.tabIndex = -1;
  queueMicrotask(() => panel.focus());

  // -- Header --
  const header = el('div', 'drawer__header');
  const headerTitle = el('h2', 'drawer__title');
  const titleIcon = svgIcon('cube-scan');
  titleIcon.classList.add('drawer__title-icon');
  headerTitle.appendChild(titleIcon);
  headerTitle.appendChild(document.createTextNode(` ${t('drawerTitle')}`));
  header.appendChild(headerTitle);

  const headerActions = el('div', 'drawer__header-actions');

  const copyBtn = el('button', 'drawer__close drawer__copy');
  copyBtn.type = 'button';
  copyBtn.title = t('copyReport');
  copyBtn.setAttribute('aria-label', t('copyReport'));
  copyBtn.appendChild(svgIcon('copy'));
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(formatAnalysisReport(record, result));
      copyBtn.title = t('copied');
      copyBtn.setAttribute('aria-label', t('copied'));
      copyBtn.classList.add('drawer__copy--success');
      copyBtn.disabled = true;
      setTimeout(() => {
        copyBtn.disabled = false;
        copyBtn.title = t('copyReport');
        copyBtn.setAttribute('aria-label', t('copyReport'));
        copyBtn.classList.remove('drawer__copy--success');
      }, 1600);
    } catch (err) {
      console.error('Failed to copy analysis report', err);
    }
  });
  headerActions.appendChild(copyBtn);

  // Copy-as-cURL: reproduces the chain server-side without exposing headers
  const curlUrl = record.initialUrl || record.events?.[0]?.from;
  if (curlUrl) {
    const curlBtn = el('button', 'drawer__close drawer__copy');
    curlBtn.type = 'button';
    curlBtn.title = t('copyCurl');
    curlBtn.setAttribute('aria-label', t('copyCurl'));
    curlBtn.appendChild(svgIcon('console'));
    curlBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(`curl -sIL '${curlUrl.replace(/'/g, "'\\''")}'`);
        curlBtn.title = t('copied');
        curlBtn.classList.add('drawer__copy--success');
        curlBtn.disabled = true;
        setTimeout(() => {
          curlBtn.disabled = false;
          curlBtn.title = t('copyCurl');
          curlBtn.classList.remove('drawer__copy--success');
        }, 1600);
      } catch (err) {
        console.error('Failed to copy curl command', err);
      }
    });
    headerActions.appendChild(curlBtn);
  }

  // Lossless JSON export of the stored record — no network, plain Blob download
  const jsonBtn = el('button', 'drawer__close drawer__copy');
  jsonBtn.type = 'button';
  jsonBtn.title = t('downloadJson');
  jsonBtn.setAttribute('aria-label', t('downloadJson'));
  jsonBtn.appendChild(svgIcon('download'));
  jsonBtn.addEventListener('click', () => {
    const blob = new Blob([`${JSON.stringify(record, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `redirect-chain-${getHost(record.finalUrl || record.initialUrl) || 'export'}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  });
  headerActions.appendChild(jsonBtn);

  const closeBtn = el('button', 'drawer__close');
  closeBtn.type = 'button';
  closeBtn.title = t('closeButton');
  closeBtn.setAttribute('aria-label', t('closeButton'));
  closeBtn.appendChild(svgIcon('close'));
  closeBtn.addEventListener('click', close);
  headerActions.appendChild(closeBtn);

  header.appendChild(headerActions);
  panel.appendChild(header);

  // -- Body --
  const body = el('div', 'drawer__body');
  const events = Array.isArray(record.events) ? record.events : [];

  // Summary line with hop badge + severity badges
  const summaryEl = el('div', 'analysis-summary');
  const hopCount = events.length;
  const hopBadge = el('span', 'hop-badge');
  hopBadge.textContent = String(hopCount);
  hopBadge.title = tPlural(hopCount, 'hopOne', 'hopOther');
  hopBadge.dataset.level = hopCount > 5 ? 'error' : hopCount > 3 ? 'warn' : 'ok';
  summaryEl.appendChild(hopBadge);

  const errorCount = result.issues.filter((i) => i.severity === 'error').length;
  const warningCount = result.issues.filter((i) => i.severity === 'warning').length;
  const infoCount = result.issues.filter((i) => i.severity === 'info').length;

  if (errorCount > 0) {
    const icon = el('span', 'analysis-summary__icon analysis-summary__icon--error');
    icon.appendChild(svgIcon('alert-circle'));
    icon.title = tPlural(errorCount, 'errorOne', 'errorOther');
    summaryEl.appendChild(icon);
  }
  if (warningCount > 0) {
    const icon = el('span', 'analysis-summary__icon analysis-summary__icon--warning');
    icon.appendChild(svgIcon('alert-circle'));
    icon.title = tPlural(warningCount, 'warningOne', 'warningOther');
    summaryEl.appendChild(icon);
  }
  if (infoCount > 0) {
    const icon = el('span', 'analysis-summary__icon analysis-summary__icon--info');
    icon.appendChild(svgIcon('info'));
    icon.title = t('infoCount', String(infoCount));
    summaryEl.appendChild(icon);
  }
  if (errorCount === 0 && warningCount === 0 && infoCount === 0) {
    const icon = el('span', 'analysis-summary__icon analysis-summary__icon--ok');
    icon.appendChild(svgIcon('check-circle'));
    icon.title = t('noIssuesDetail');
    summaryEl.appendChild(icon);
  }
  body.appendChild(summaryEl);

  // Issues list
  if (result.issues.length > 0) {
    const issuesSection = el('div', 'analysis-issues');
    for (const issue of result.issues) {
      const card = el('div', `analysis-issue analysis-issue--${issue.severity}`);

      const titleRow = el('div', 'analysis-issue__title');
      const icon = el('span', 'analysis-issue__icon');
      icon.appendChild(svgIcon(severityIcon(issue.severity)));
      titleRow.appendChild(icon);
      titleRow.appendChild(document.createTextNode(` ${issue.title}`));
      card.appendChild(titleRow);

      const detail = el('div', 'analysis-issue__detail');
      if (issue.id === 'CHAIN_LENGTH') {
        // Inject hop count as a badge: "Chain has <badge> hops. ..."
        const match = issue.detail.match(/^(Chain has )(\d+)( hops?\. .+)$/);
        if (match) {
          const count = Number(match[2]);
          detail.appendChild(document.createTextNode(match[1]));
          const badge = el('span', 'hop-badge');
          badge.textContent = match[2];
          badge.title = tPlural(count, 'hopOne', 'hopOther');
          badge.dataset.level = count > 5 ? 'error' : count > 3 ? 'warn' : 'ok';
          detail.appendChild(badge);
          detail.appendChild(document.createTextNode(match[3]));
        } else {
          detail.textContent = issue.detail;
        }
      } else {
        detail.textContent = issue.detail;
      }
      card.appendChild(detail);

      issuesSection.appendChild(card);
    }
    body.appendChild(issuesSection);
  }

  // Tags row
  if (result.tags.length > 0) {
    const tagsRow = el('div', 'analysis-tags');
    for (const tag of result.tags) {
      tagsRow.appendChild(el('span', 'analysis-tag', tag));
    }
    body.appendChild(tagsRow);
  }

  // Hop table
  if (events.length > 0) {
    const hopsSection = el('div', 'analysis-hops');
    const hopsTitle = el('h3', 'analysis-hops__title', t('hopsTitle'));
    hopsSection.appendChild(hopsTitle);

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const ann = result.hopAnnotations[i];
      const row = el('div', 'analysis-hop');

      const statusCode = String(ev.statusCode ?? '\u2014');
      const status = el('span', 'redirect-step__status', statusCode);
      status.dataset.status = statusCode;
      const hint = statusTitle(statusCode);
      if (hint) status.title = hint;
      row.appendChild(status);

      const labels = hopEndpointLabels(ev.from, ev.to);
      const fromLabel = labels.from || getHost(ev.from) || '?';
      const toLabel = labels.to || getHost(ev.to) || '';
      const hosts = el('span', 'analysis-hop__hosts');
      hosts.textContent = toLabel ? `${fromLabel} \u2192 ${toLabel}` : fromLabel;
      hosts.title = `${ev.from || ''} \u2192 ${ev.to || ''}`;
      row.appendChild(hosts);

      // Per-hop time delta when both timestamps were captured
      const prevTs = i > 0 ? events[i - 1].timestampMs : Date.parse(record.initiatedAt ?? '');
      const delta = typeof ev.timestampMs === 'number' && Number.isFinite(prevTs) ? ev.timestampMs - prevTs! : NaN;
      if (Number.isFinite(delta) && delta >= 0 && delta < 5 * 60 * 1000) {
        row.appendChild(el('span', 'analysis-hop__delta', `+${Math.round(delta)} ms`));
      }

      if (ann && ann.tags.length > 0) {
        const hopTags = el('span', 'analysis-hop__tags');
        for (const tag of ann.tags) {
          hopTags.appendChild(el('span', 'analysis-tag analysis-tag--sm', tag));
        }
        row.appendChild(hopTags);
      }

      hopsSection.appendChild(row);
    }
    body.appendChild(hopsSection);
  }

  panel.appendChild(body);

  // -- Footer --
  const footer = el('div', 'drawer__footer');
  const finalUrl = record.finalUrl || events.at(-1)?.to || events.at(-1)?.from || record.initialUrl;
  if (finalUrl) {
    const finalLabel = el('span', 'drawer__final-url');
    finalLabel.textContent = t('finalUrl', getHost(finalUrl) || finalUrl);
    finalLabel.title = finalUrl;
    footer.appendChild(finalLabel);
  }
  if (record.finalStatus) {
    footer.appendChild(el('span', 'drawer__final-status', t('finalStatus', String(record.finalStatus))));
  }
  panel.appendChild(footer);

  drawer.appendChild(panel);
  return drawer;
}
