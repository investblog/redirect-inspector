import { describe, expect, it } from 'vitest';
import type { RedirectRecord } from '../../shared/types/redirect';
import { buildSessionGroups, recordTimestamp } from './session-groups';

function makeRecord(overrides: Partial<RedirectRecord> = {}): RedirectRecord {
  return {
    id: 'test-id',
    tabId: 1,
    initiatedAt: '2024-01-01T00:00:00.000Z',
    events: [],
    ...overrides,
  };
}

describe('recordTimestamp', () => {
  it('returns ms from initiatedAt', () => {
    const r = makeRecord({ initiatedAt: '2024-01-01T00:00:00.000Z' });
    expect(recordTimestamp(r)).toBe(new Date('2024-01-01T00:00:00.000Z').getTime());
  });

  it('returns 0 for missing initiatedAt', () => {
    const r = makeRecord({ initiatedAt: '' });
    expect(recordTimestamp(r)).toBe(0);
  });
});

describe('buildSessionGroups', () => {
  it('single record → singleton group with no satellites', () => {
    const r = makeRecord({ tabId: 1 });
    const groups = buildSessionGroups([r], true);
    expect(groups).toHaveLength(1);
    expect(groups[0].primary).toBe(r);
    expect(groups[0].satellites).toHaveLength(0);
  });

  it('same tabId within 60s with shared domain → one group', () => {
    const r1 = makeRecord({
      id: 'a',
      tabId: 5,
      initiatedAt: '2024-01-01T00:00:00.000Z',
      initialUrl: 'https://example.com/page',
      events: [
        {
          timestamp: '',
          from: 'https://example.com',
          to: 'https://example.com/home',
          statusCode: 301,
          method: 'GET',
          type: 'main_frame',
        },
      ],
    });
    const r2 = makeRecord({
      id: 'b',
      tabId: 5,
      initiatedAt: '2024-01-01T00:00:30.000Z',
      initialUrl: 'https://example.com/auth',
      events: [
        {
          timestamp: '',
          from: 'https://example.com/auth',
          to: 'https://example.com/cb',
          statusCode: 302,
          method: 'GET',
          type: 'main_frame',
        },
      ],
    });
    const groups = buildSessionGroups([r1, r2], true);
    expect(groups).toHaveLength(1);
    expect(groups[0].satellites).toHaveLength(1);
  });

  it('same tabId 90s apart → two groups', () => {
    const r1 = makeRecord({
      id: 'a',
      tabId: 5,
      initiatedAt: '2024-01-01T00:00:00.000Z',
      initialUrl: 'https://example.com',
    });
    const r2 = makeRecord({
      id: 'b',
      tabId: 5,
      initiatedAt: '2024-01-01T00:01:30.000Z',
      initialUrl: 'https://example.com',
    });
    const groups = buildSessionGroups([r1, r2], true);
    expect(groups).toHaveLength(2);
    expect(groups[0].satellites).toHaveLength(0);
    expect(groups[1].satellites).toHaveLength(0);
  });

  it('tabId -1 → never grouped', () => {
    const r1 = makeRecord({ id: 'a', tabId: -1, initiatedAt: '2024-01-01T00:00:00.000Z' });
    const r2 = makeRecord({ id: 'b', tabId: -1, initiatedAt: '2024-01-01T00:00:05.000Z' });
    const groups = buildSessionGroups([r1, r2], true);
    expect(groups).toHaveLength(2);
    for (const g of groups) {
      expect(g.satellites).toHaveLength(0);
    }
  });

  it('tabId 0 → never grouped', () => {
    const r1 = makeRecord({ id: 'a', tabId: 0, initiatedAt: '2024-01-01T00:00:00.000Z' });
    const r2 = makeRecord({ id: 'b', tabId: 0, initiatedAt: '2024-01-01T00:00:05.000Z' });
    const groups = buildSessionGroups([r1, r2], true);
    expect(groups).toHaveLength(2);
  });

  it('primary prefers non-noise over noise', () => {
    const noisy = makeRecord({
      id: 'noisy',
      tabId: 3,
      initiatedAt: '2024-01-01T00:00:00.000Z',
      classification: 'likely-tracking',
      events: [
        {
          timestamp: '',
          from: 'https://example.com/pixel',
          to: 'https://example.com/track',
          statusCode: 301,
          method: 'GET',
          type: 'main_frame',
        },
        {
          timestamp: '',
          from: 'https://example.com/track',
          to: 'https://example.com/done',
          statusCode: 302,
          method: 'GET',
          type: 'main_frame',
        },
      ],
    });
    const normal = makeRecord({
      id: 'normal',
      tabId: 3,
      initiatedAt: '2024-01-01T00:00:10.000Z',
      classification: 'normal',
      events: [
        {
          timestamp: '',
          from: 'https://example.com',
          to: 'https://example.com/home',
          statusCode: 301,
          method: 'GET',
          type: 'main_frame',
        },
      ],
    });
    const groups = buildSessionGroups([noisy, normal], true);
    expect(groups).toHaveLength(1);
    expect(groups[0].primary.id).toBe('normal');
    expect(groups[0].satellites).toHaveLength(1);
    expect(groups[0].satellites[0].id).toBe('noisy');
  });

  it('primary prefers most hops when equal noise status', () => {
    const fewer = makeRecord({
      id: 'fewer',
      tabId: 3,
      initiatedAt: '2024-01-01T00:00:00.000Z',
      events: [
        {
          timestamp: '',
          from: 'https://a.com',
          to: 'https://b.com',
          statusCode: 301,
          method: 'GET',
          type: 'main_frame',
        },
      ],
    });
    const more = makeRecord({
      id: 'more',
      tabId: 3,
      initiatedAt: '2024-01-01T00:00:10.000Z',
      events: [
        {
          timestamp: '',
          from: 'https://a.com',
          to: 'https://b.com',
          statusCode: 301,
          method: 'GET',
          type: 'main_frame',
        },
        {
          timestamp: '',
          from: 'https://b.com',
          to: 'https://c.com',
          statusCode: 302,
          method: 'GET',
          type: 'main_frame',
        },
        {
          timestamp: '',
          from: 'https://c.com',
          to: 'https://d.com',
          statusCode: 301,
          method: 'GET',
          type: 'main_frame',
        },
      ],
    });
    const groups = buildSessionGroups([fewer, more], true);
    expect(groups).toHaveLength(1);
    expect(groups[0].primary.id).toBe('more');
  });

  it('noise satellites hidden when showingNoise=false', () => {
    const main = makeRecord({
      id: 'main',
      tabId: 3,
      initiatedAt: '2024-01-01T00:00:00.000Z',
      classification: 'normal',
      initialUrl: 'https://example.com',
      events: [
        {
          timestamp: '',
          from: 'https://example.com',
          to: 'https://example.com/home',
          statusCode: 301,
          method: 'GET',
          type: 'main_frame',
        },
      ],
    });
    const tracker = makeRecord({
      id: 'tracker',
      tabId: 3,
      initiatedAt: '2024-01-01T00:00:05.000Z',
      classification: 'likely-tracking',
      initialUrl: 'https://example.com/pixel',
      events: [
        {
          timestamp: '',
          from: 'https://example.com/pixel',
          to: 'https://example.com/track',
          statusCode: 302,
          method: 'GET',
          type: 'main_frame',
        },
      ],
    });
    const groups = buildSessionGroups([main, tracker], false);
    expect(groups).toHaveLength(1);
    expect(groups[0].primary.id).toBe('main');
    expect(groups[0].satellites).toHaveLength(0);
  });

  it('all-noise group hidden when showingNoise=false', () => {
    const tracker1 = makeRecord({
      id: 't1',
      tabId: 3,
      initiatedAt: '2024-01-01T00:00:00.000Z',
      classification: 'likely-tracking',
      initialUrl: 'https://tracker.com/pixel',
      events: [
        {
          timestamp: '',
          from: 'https://tracker.com/pixel',
          to: 'https://tracker.com/done',
          statusCode: 302,
          method: 'GET',
          type: 'main_frame',
        },
      ],
    });
    const tracker2 = makeRecord({
      id: 't2',
      tabId: 3,
      initiatedAt: '2024-01-01T00:00:05.000Z',
      classification: 'likely-media',
      initialUrl: 'https://tracker.com/media',
      events: [
        {
          timestamp: '',
          from: 'https://tracker.com/media',
          to: 'https://tracker.com/cdn',
          statusCode: 301,
          method: 'GET',
          type: 'main_frame',
        },
      ],
    });
    const groups = buildSessionGroups([tracker1, tracker2], false);
    expect(groups).toHaveLength(0);
  });

  it('pending records always singletons, appear first', () => {
    const pending = makeRecord({
      id: 'pending',
      tabId: 3,
      initiatedAt: '2024-01-01T00:00:30.000Z',
      pending: true,
    });
    const completed = makeRecord({
      id: 'completed',
      tabId: 3,
      initiatedAt: '2024-01-01T00:00:00.000Z',
      events: [
        {
          timestamp: '',
          from: 'https://a.com',
          to: 'https://b.com',
          statusCode: 301,
          method: 'GET',
          type: 'main_frame',
        },
      ],
    });
    const groups = buildSessionGroups([completed, pending], true);
    expect(groups).toHaveLength(2);
    // Pending first
    expect(groups[0].primary.id).toBe('pending');
    expect(groups[0].satellites).toHaveLength(0);
    // Completed second
    expect(groups[1].primary.id).toBe('completed');
  });

  it('different tabIds are separate groups', () => {
    const r1 = makeRecord({ id: 'a', tabId: 1, initiatedAt: '2024-01-01T00:00:00.000Z' });
    const r2 = makeRecord({ id: 'b', tabId: 2, initiatedAt: '2024-01-01T00:00:05.000Z' });
    const groups = buildSessionGroups([r1, r2], true);
    expect(groups).toHaveLength(2);
  });

  it('completed groups sorted newest primary first', () => {
    const older = makeRecord({ id: 'old', tabId: 1, initiatedAt: '2024-01-01T00:00:00.000Z' });
    const newer = makeRecord({ id: 'new', tabId: 2, initiatedAt: '2024-01-01T00:05:00.000Z' });
    const groups = buildSessionGroups([older, newer], true);
    expect(groups).toHaveLength(2);
    expect(groups[0].primary.id).toBe('new');
    expect(groups[1].primary.id).toBe('old');
  });

  it('handles empty input', () => {
    const groups = buildSessionGroups([], true);
    expect(groups).toHaveLength(0);
  });

  it('exactly 60s apart with shared domain → same group', () => {
    const r1 = makeRecord({
      id: 'a',
      tabId: 5,
      initiatedAt: '2024-01-01T00:00:00.000Z',
      initialUrl: 'https://example.com',
    });
    const r2 = makeRecord({
      id: 'b',
      tabId: 5,
      initiatedAt: '2024-01-01T00:01:00.000Z',
      initialUrl: 'https://example.com/page',
    });
    const groups = buildSessionGroups([r1, r2], true);
    expect(groups).toHaveLength(1);
  });

  it('61s apart → two groups', () => {
    const r1 = makeRecord({
      id: 'a',
      tabId: 5,
      initiatedAt: '2024-01-01T00:00:00.000Z',
      initialUrl: 'https://example.com',
    });
    const r2 = makeRecord({
      id: 'b',
      tabId: 5,
      initiatedAt: '2024-01-01T00:01:01.000Z',
      initialUrl: 'https://example.com',
    });
    const groups = buildSessionGroups([r1, r2], true);
    expect(groups).toHaveLength(2);
  });

  // ---- Domain affinity ----

  it('same tabId + time window but no shared domains → separate groups', () => {
    const yandex = makeRecord({
      id: 'yandex',
      tabId: 5,
      initiatedAt: '2024-01-01T00:00:00.000Z',
      initialUrl: 'https://www.yandex.ru',
      finalUrl: 'https://dzen.ru',
      events: [
        {
          timestamp: '',
          from: 'https://www.yandex.ru',
          to: 'https://yandex.ru',
          statusCode: 301,
          method: 'GET',
          type: 'main_frame',
        },
        {
          timestamp: '',
          from: 'https://yandex.ru',
          to: 'https://dzen.ru',
          statusCode: 302,
          method: 'GET',
          type: 'main_frame',
        },
      ],
    });
    const cdn = makeRecord({
      id: 'cdn',
      tabId: 5,
      initiatedAt: '2024-01-01T00:00:02.000Z',
      initialUrl: 'https://cdn-probe-reports.mrgcdn.ru/stat',
      events: [
        {
          timestamp: '',
          from: 'https://cdn-probe-reports.mrgcdn.ru/stat',
          to: 'https://cdn-probe-reports.mrgcdn.ru/v2',
          statusCode: 301,
          method: 'GET',
          type: 'sub_frame',
        },
      ],
    });
    const site301 = makeRecord({
      id: 'site301',
      tabId: 5,
      initiatedAt: '2024-01-01T00:00:03.000Z',
      initialUrl: 'https://301.st/check',
      events: [
        {
          timestamp: '',
          from: 'https://301.st/check',
          to: 'https://301.st/ok',
          statusCode: 301,
          method: 'GET',
          type: 'sub_frame',
        },
      ],
    });

    const groups = buildSessionGroups([yandex, cdn, site301], true);
    // yandex is its own group (primary), cdn and 301.st are separate singletons
    expect(groups).toHaveLength(3);
    const primaries = groups.map((g) => g.primary.id).sort();
    expect(primaries).toEqual(['cdn', 'site301', 'yandex']);
    for (const g of groups) {
      expect(g.satellites).toHaveLength(0);
    }
  });

  it('satellite with shared host is grouped, unrelated becomes singleton', () => {
    const main = makeRecord({
      id: 'main',
      tabId: 5,
      initiatedAt: '2024-01-01T00:00:00.000Z',
      initialUrl: 'https://www.yandex.ru',
      finalUrl: 'https://dzen.ru',
      events: [
        {
          timestamp: '',
          from: 'https://www.yandex.ru',
          to: 'https://yandex.ru',
          statusCode: 301,
          method: 'GET',
          type: 'main_frame',
        },
        {
          timestamp: '',
          from: 'https://yandex.ru',
          to: 'https://dzen.ru',
          statusCode: 302,
          method: 'GET',
          type: 'main_frame',
        },
      ],
    });
    const related = makeRecord({
      id: 'oauth',
      tabId: 5,
      initiatedAt: '2024-01-01T00:00:05.000Z',
      initialUrl: 'https://yandex.ru/oauth',
      events: [
        {
          timestamp: '',
          from: 'https://yandex.ru/oauth',
          to: 'https://yandex.ru/cb',
          statusCode: 302,
          method: 'GET',
          type: 'main_frame',
        },
      ],
    });
    const unrelated = makeRecord({
      id: 'unrelated',
      tabId: 5,
      initiatedAt: '2024-01-01T00:00:08.000Z',
      initialUrl: 'https://totally-different.com',
      events: [
        {
          timestamp: '',
          from: 'https://totally-different.com',
          to: 'https://totally-different.com/v2',
          statusCode: 301,
          method: 'GET',
          type: 'sub_frame',
        },
      ],
    });

    const groups = buildSessionGroups([main, related, unrelated], true);
    expect(groups).toHaveLength(2);

    const mainGroup = groups.find((g) => g.primary.id === 'main')!;
    expect(mainGroup).toBeDefined();
    expect(mainGroup.satellites).toHaveLength(1);
    expect(mainGroup.satellites[0].id).toBe('oauth');

    const singletonGroup = groups.find((g) => g.primary.id === 'unrelated')!;
    expect(singletonGroup).toBeDefined();
    expect(singletonGroup.satellites).toHaveLength(0);
  });

  it('recursive partitioning: unrelated records sharing domain form their own group', () => {
    const yandex = makeRecord({
      id: 'yandex',
      tabId: 5,
      initiatedAt: '2024-01-01T00:00:00.000Z',
      initialUrl: 'https://www.yandex.ru',
      finalUrl: 'https://dzen.ru',
      events: [
        {
          timestamp: '',
          from: 'https://www.yandex.ru',
          to: 'https://yandex.ru',
          statusCode: 301,
          method: 'GET',
          type: 'main_frame',
        },
        {
          timestamp: '',
          from: 'https://yandex.ru',
          to: 'https://dzen.ru',
          statusCode: 302,
          method: 'GET',
          type: 'main_frame',
        },
      ],
    });
    const site301a = makeRecord({
      id: '301a',
      tabId: 5,
      initiatedAt: '2024-01-01T00:00:03.000Z',
      initialUrl: 'https://301.st/check',
      events: [
        {
          timestamp: '',
          from: 'https://301.st/check',
          to: 'https://301.st/ok',
          statusCode: 301,
          method: 'GET',
          type: 'sub_frame',
        },
      ],
    });
    const site301b = makeRecord({
      id: '301b',
      tabId: 5,
      initiatedAt: '2024-01-01T00:00:06.000Z',
      initialUrl: 'https://301.st/other',
      events: [
        {
          timestamp: '',
          from: 'https://301.st/other',
          to: 'https://301.st/done',
          statusCode: 302,
          method: 'GET',
          type: 'sub_frame',
        },
      ],
    });

    const groups = buildSessionGroups([yandex, site301a, site301b], true);
    // yandex is its own group; the two 301.st records should be grouped together
    expect(groups).toHaveLength(2);

    const yandexGroup = groups.find((g) => g.primary.id === 'yandex')!;
    expect(yandexGroup).toBeDefined();
    expect(yandexGroup.satellites).toHaveLength(0);

    const site301Group = groups.find((g) => g.primary.id === '301a' || g.primary.id === '301b')!;
    expect(site301Group).toBeDefined();
    expect(site301Group.satellites).toHaveLength(1);
  });

  it('initiator domain creates affinity', () => {
    const main = makeRecord({
      id: 'main',
      tabId: 5,
      initiatedAt: '2024-01-01T00:00:00.000Z',
      initialUrl: 'https://example.com',
      events: [
        {
          timestamp: '',
          from: 'https://example.com',
          to: 'https://example.com/home',
          statusCode: 301,
          method: 'GET',
          type: 'main_frame',
        },
      ],
    });
    const sub = makeRecord({
      id: 'sub',
      tabId: 5,
      initiatedAt: '2024-01-01T00:00:02.000Z',
      initiator: 'https://example.com',
      initialUrl: 'https://cdn.other.com/asset',
      events: [
        {
          timestamp: '',
          from: 'https://cdn.other.com/asset',
          to: 'https://cdn.other.com/v2/asset',
          statusCode: 301,
          method: 'GET',
          type: 'sub_frame',
        },
      ],
    });

    const groups = buildSessionGroups([main, sub], true);
    expect(groups).toHaveLength(1);
    expect(groups[0].primary.id).toBe('main');
    expect(groups[0].satellites).toHaveLength(1);
    expect(groups[0].satellites[0].id).toBe('sub');
  });
});
