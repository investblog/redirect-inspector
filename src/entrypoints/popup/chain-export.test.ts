import { describe, expect, it } from 'vitest';
import type { RedirectEvent, RedirectRecord } from '../../shared/types/redirect';
import { formatRedirectChainForExport } from './chain-export';

function hop(from: string, to: string, statusCode: number): RedirectEvent {
  return { timestamp: '2026-10-22T00:00:00.000Z', from, to, statusCode, method: 'GET', type: 'main_frame' };
}

describe('formatRedirectChainForExport', () => {
  it('keeps same-host hops and prints URLs verbatim', () => {
    const last = 'https://www.oktagonbet.com/ibet-web-client?t=home&a_aid=301st';
    const landing = 'https://www.oktagonbet.com/ibet-web-client/?t=home&a_aid=301st';
    const record: RedirectRecord = {
      id: 'r1',
      tabId: 1,
      initiatedAt: '2026-10-22T00:00:00.000Z',
      initialUrl: 'https://clx.bet/r?t=home',
      finalUrl: landing,
      events: [hop('https://clx.bet/r?t=home', last, 302), hop(last, landing, 302)],
    };

    const text = formatRedirectChainForExport(record);

    expect(text).toContain(`1. 302 → ${last}\n`);
    expect(text).toContain(`2. 302 → ${landing}\n`);
    expect(text).toContain(`Final URL: ${landing}\n`);
  });

  it('does not strip a fragment from the final URL', () => {
    const record: RedirectRecord = {
      id: 'r2',
      tabId: 1,
      initiatedAt: '2026-10-22T00:00:00.000Z',
      finalUrl: 'https://example.com/app/#/registration',
      events: [hop('https://example.com/', 'https://example.com/app/#/registration', 301)],
    };

    expect(formatRedirectChainForExport(record)).toContain('Final URL: https://example.com/app/#/registration\n');
  });
});
