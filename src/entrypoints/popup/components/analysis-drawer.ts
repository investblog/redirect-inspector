import type { AnalysisResult } from '../../../shared/analysis/types';
import type { RedirectRecord } from '../../../shared/types/redirect';
import { el, severityIcon, statusTitle, svgIcon } from '../helpers';

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

  // Overlay
  const overlay = el('div', 'drawer__overlay');
  overlay.addEventListener('click', () => {
    drawer.remove();
    onClose();
  });
  drawer.appendChild(overlay);

  // Panel
  const panel = el('div', 'drawer__panel');

  // -- Header --
  const header = el('div', 'drawer__header');
  const headerTitle = el('h2', 'drawer__title', 'Chain Analysis');
  header.appendChild(headerTitle);

  const headerActions = el('div', 'drawer__header-actions');

  const copyBtn = el('button', 'drawer__close drawer__copy');
  copyBtn.type = 'button';
  copyBtn.title = 'Copy analysis report';
  copyBtn.setAttribute('aria-label', 'Copy analysis report');
  copyBtn.appendChild(svgIcon('copy'));
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(formatAnalysisReport(record, result));
      copyBtn.title = 'Copied!';
      copyBtn.setAttribute('aria-label', 'Copied!');
      copyBtn.classList.add('drawer__copy--success');
      copyBtn.disabled = true;
      setTimeout(() => {
        copyBtn.disabled = false;
        copyBtn.title = 'Copy analysis report';
        copyBtn.setAttribute('aria-label', 'Copy analysis report');
        copyBtn.classList.remove('drawer__copy--success');
      }, 1600);
    } catch (err) {
      console.error('Failed to copy analysis report', err);
    }
  });
  headerActions.appendChild(copyBtn);

  const closeBtn = el('button', 'drawer__close');
  closeBtn.type = 'button';
  closeBtn.title = 'Close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.appendChild(svgIcon('close'));
  closeBtn.addEventListener('click', () => {
    drawer.remove();
    onClose();
  });
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
  hopBadge.title = hopCount === 1 ? '1 hop' : `${hopCount} hops`;
  hopBadge.dataset.level = hopCount > 5 ? 'error' : hopCount > 3 ? 'warn' : 'ok';
  summaryEl.appendChild(hopBadge);

  const errorCount = result.issues.filter((i) => i.severity === 'error').length;
  const warningCount = result.issues.filter((i) => i.severity === 'warning').length;
  const infoCount = result.issues.filter((i) => i.severity === 'info').length;

  if (errorCount > 0) {
    const badge = el('span', 'hop-badge');
    badge.dataset.level = 'error';
    badge.textContent = `${errorCount} error${errorCount > 1 ? 's' : ''}`;
    badge.title = `${errorCount} error-level issue${errorCount > 1 ? 's' : ''}`;
    summaryEl.appendChild(badge);
  }
  if (warningCount > 0) {
    const badge = el('span', 'hop-badge');
    badge.dataset.level = 'warn';
    badge.textContent = `${warningCount} warning${warningCount > 1 ? 's' : ''}`;
    badge.title = `${warningCount} warning-level issue${warningCount > 1 ? 's' : ''}`;
    summaryEl.appendChild(badge);
  }
  if (infoCount > 0) {
    const badge = el('span', 'hop-badge');
    badge.dataset.level = 'info';
    badge.textContent = `${infoCount} info`;
    badge.title = `${infoCount} informational issue${infoCount > 1 ? 's' : ''}`;
    summaryEl.appendChild(badge);
  }
  if (errorCount === 0 && warningCount === 0 && infoCount === 0) {
    const badge = el('span', 'hop-badge');
    badge.textContent = 'no issues';
    badge.title = 'No issues detected';
    summaryEl.appendChild(badge);
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
          badge.title = count === 1 ? '1 hop' : `${count} hops`;
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
    const hopsTitle = el('h3', 'analysis-hops__title', 'Hops');
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

      const fromHost = getHost(ev.from) || '?';
      const toHost = getHost(ev.to) || '';
      const hosts = el('span', 'analysis-hop__hosts');
      hosts.textContent = toHost ? `${fromHost} \u2192 ${toHost}` : fromHost;
      hosts.title = `${ev.from || ''} \u2192 ${ev.to || ''}`;
      row.appendChild(hosts);

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
    finalLabel.textContent = `Final: ${getHost(finalUrl) || finalUrl}`;
    finalLabel.title = finalUrl;
    footer.appendChild(finalLabel);
  }
  if (record.finalStatus) {
    footer.appendChild(el('span', 'drawer__final-status', `Status: ${record.finalStatus}`));
  }
  panel.appendChild(footer);

  drawer.appendChild(panel);
  return drawer;
}
