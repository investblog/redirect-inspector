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

  it('adds the address bar line only for a client-side landing, flagging redaction', () => {
    const base: RedirectRecord = {
      id: 'r3',
      tabId: 1,
      initiatedAt: '2026-10-22T00:00:00.000Z',
      finalUrl: 'https://example.com/app/',
      events: [hop('https://example.com/', 'https://example.com/app/', 302)],
    };
    expect(formatRedirectChainForExport(base)).not.toContain('Address bar:');

    const landing = {
      url: 'https://example.com/app/#/registration',
      via: 'fragment' as const,
      delayMs: 900,
      changes: 1,
    };
    expect(formatRedirectChainForExport({ ...base, clientLanding: { ...landing, redacted: false } })).toContain(
      'Final URL: https://example.com/app/\nAddress bar: https://example.com/app/#/registration (changed client-side, no server request)\n',
    );
    expect(
      formatRedirectChainForExport({
        ...base,
        clientLanding: { ...landing, url: 'https://example.com/cb#access_token=***', redacted: true },
      }),
    ).toContain(
      'Address bar: https://example.com/cb#access_token=*** (changed client-side, no server request; sensitive values redacted)',
    );
  });
});
