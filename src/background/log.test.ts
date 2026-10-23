import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RedirectRecord } from '../shared/types/redirect';

// In-memory storage.local whose reads and writes yield to the event loop, so
// unserialized read-modify-writes would interleave like they do in a browser.
const store: Record<string, unknown> = {};
const failNext = { get: false, set: false };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (key: string) => {
          await tick();
          if (failNext.get) {
            failNext.get = false;
            throw new Error('get failed');
          }
          return key in store ? { [key]: structuredClone(store[key]) } : {};
        },
        set: async (items: Record<string, unknown>) => {
          await tick();
          if (failNext.set) {
            failNext.set = false;
            throw new Error('set failed');
          }
          Object.assign(store, structuredClone(items));
        },
      },
    },
  },
}));

const { appendRedirectRecord, clearRedirectLog, restoreRedirectRecords, seedRedirectLogIfEmpty, updateClientLanding } =
  await import('./log');

const LANDING = { url: 'https://a.example/#/x', via: 'fragment' as const, delayMs: 10, changes: 1, redacted: false };

function rec(id: string): RedirectRecord {
  return { id, tabId: 1, initiatedAt: '2026-10-22T00:00:00.000Z', events: [] };
}

function ids(): string[] {
  return ((store.redirectLog as RedirectRecord[]) ?? []).map((r) => r.id);
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  failNext.get = false;
  failNext.set = false;
});

describe('redirect log write queue', () => {
  it('keeps every record when appends run concurrently', async () => {
    await Promise.all([appendRedirectRecord(rec('a')), appendRedirectRecord(rec('b')), appendRedirectRecord(rec('c'))]);
    expect(ids()).toEqual(['c', 'b', 'a']);
  });

  it('does not resurrect cleared records when an append races a clear', async () => {
    store.redirectLog = [rec('old')];
    await Promise.all([appendRedirectRecord(rec('new')), clearRedirectLog()]);
    expect(ids()).toEqual([]);
  });

  it('keeps an append queued after a clear, without the cleared records', async () => {
    store.redirectLog = [rec('old')];
    await Promise.all([clearRedirectLog(), appendRedirectRecord(rec('new'))]);
    expect(ids()).toEqual(['new']);
  });

  it('clear returns the removed records, including an append queued just before it', async () => {
    store.redirectLog = [rec('old')];
    const [, cleared] = await Promise.all([appendRedirectRecord(rec('unseen')), clearRedirectLog()]);
    expect(cleared.map((r) => r.id)).toEqual(['unseen', 'old']);
  });

  it('restore merges the snapshot with records appended after the clear', async () => {
    store.redirectLog = [rec('a'), rec('b')];
    const cleared = await clearRedirectLog();
    await Promise.all([appendRedirectRecord(rec('c')), restoreRedirectRecords(cleared)]);
    expect(ids()).toEqual(['c', 'a', 'b']);
  });

  it('restore does not duplicate a record that is still present', async () => {
    store.redirectLog = [rec('a')];
    await restoreRedirectRecords([rec('a'), rec('b')]);
    expect(ids()).toEqual(['a', 'b']);
  });

  it('seeds only an empty log, even when a real record lands first', async () => {
    await Promise.all([appendRedirectRecord(rec('real')), seedRedirectLogIfEmpty(rec('demo'))]);
    expect(ids()).toEqual(['real']);

    for (const key of Object.keys(store)) delete store[key];
    await seedRedirectLogIfEmpty(rec('demo'));
    expect(ids()).toEqual(['demo']);
  });

  it.each([
    'get',
    'set',
  ] as const)('rejects to the caller and keeps the queue running after a failed %s', async (op) => {
    store.redirectLog = [rec('a')];
    failNext[op] = true;
    const failed = clearRedirectLog();
    const next = appendRedirectRecord(rec('b'));
    await expect(failed).rejects.toThrow(`${op} failed`);
    await next;
    expect(ids()).toEqual(['b', 'a']);
  });

  it('append never rejects, even when storage fails', async () => {
    failNext.set = true;
    await expect(appendRedirectRecord(rec('a'))).resolves.toBeUndefined();
    await appendRedirectRecord(rec('b'));
    expect(ids()).toEqual(['b']);
  });

  it('attaches a landing to the record just appended, even when both are queued together', async () => {
    store.redirectLog = [rec('other')];
    await Promise.all([appendRedirectRecord(rec('r')), updateClientLanding('r', LANDING)]);
    const log = store.redirectLog as RedirectRecord[];
    expect(log.find((r) => r.id === 'r')?.clientLanding).toEqual(LANDING);
    expect(log.find((r) => r.id === 'other')?.clientLanding).toBeUndefined();
  });

  it('does not resurrect a cleared record when its landing arrives after Clear', async () => {
    store.redirectLog = [rec('r')];
    await Promise.all([clearRedirectLog(), updateClientLanding('r', LANDING)]);
    expect(ids()).toEqual([]);
  });
});
