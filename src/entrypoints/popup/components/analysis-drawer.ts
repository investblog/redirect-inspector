import type { AnalysisResult, Severity } from '../../../shared/analysis/types';
import type { RedirectRecord } from '../../../shared/types/redirect';
import { el, ICONS, svgIcon } from '../helpers';

function getHost(url: string | undefined): string {
  try {
    return new URL(url!).host;
  } catch {
    return '';
  }
}

const SEVERITY_ICON_PATH: Record<Severity, string> = {
  error: ICONS.xCircle,
  warning: ICONS.alertTriangle,
  info: ICONS.info,
};

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

  const closeBtn = el('button', 'drawer__close');
  closeBtn.type = 'button';
  closeBtn.title = 'Close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.appendChild(svgIcon(ICONS.x, 16));
  closeBtn.addEventListener('click', () => {
    drawer.remove();
    onClose();
  });
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // -- Body --
  const body = el('div', 'drawer__body');

  // Summary line
  const summaryEl = el('div', 'analysis-summary', result.summary);
  body.appendChild(summaryEl);

  // Issues list
  if (result.issues.length > 0) {
    const issuesSection = el('div', 'analysis-issues');
    for (const issue of result.issues) {
      const card = el('div', `analysis-issue analysis-issue--${issue.severity}`);

      const titleRow = el('div', 'analysis-issue__title');
      const icon = el('span', 'analysis-issue__icon');
      icon.appendChild(svgIcon(SEVERITY_ICON_PATH[issue.severity], 14));
      titleRow.appendChild(icon);
      titleRow.appendChild(document.createTextNode(` ${issue.title}`));
      card.appendChild(titleRow);

      const detail = el('div', 'analysis-issue__detail', issue.detail);
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
  const events = Array.isArray(record.events) ? record.events : [];
  if (events.length > 0) {
    const hopsSection = el('div', 'analysis-hops');
    const hopsTitle = el('h3', 'analysis-hops__title', 'Hops');
    hopsSection.appendChild(hopsTitle);

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const ann = result.hopAnnotations[i];
      const row = el('div', 'analysis-hop');

      const status = el('span', 'redirect-step__status', String(ev.statusCode ?? '\u2014'));
      status.dataset.status = String(ev.statusCode ?? '\u2014');
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
