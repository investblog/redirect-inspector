import { browser } from 'wxt/browser';
import type { RedirectRecord } from '../shared/types/redirect';
import { MAX_RECORDS, REDIRECT_LOG_KEY } from './helpers';

let writeQueue: Promise<void> = Promise.resolve();

/**
 * Every mutation of the persisted log goes through this one queue. The log is
 * a read-modify-write of one storage key: an append racing a Clear would
 * otherwise write back the records Clear just removed, and two appends would
 * overwrite each other. Rejects on storage failure; the queue keeps going.
 */
function mutateLog(mutate: (log: RedirectRecord[]) => RedirectRecord[]): Promise<void> {
  const run = writeQueue.then(async () => {
    const { [REDIRECT_LOG_KEY]: existing = [] } = await browser.storage.local.get(REDIRECT_LOG_KEY);
    await browser.storage.local.set({ [REDIRECT_LOG_KEY]: mutate(existing as RedirectRecord[]) });
  });
  writeQueue = run.catch(() => {});
  return run;
}

/** Prepend a record to the persisted log. Never rejects. */
export function appendRedirectRecord(record: RedirectRecord): Promise<void> {
  return mutateLog((log) => [record, ...log].slice(0, MAX_RECORDS)).catch((error) => {
    console.error('Failed to append redirect record', error);
  });
}

/** Write `record` as the only entry, but only when the log is empty. */
export function seedRedirectLogIfEmpty(record: RedirectRecord): Promise<void> {
  return mutateLog((log) => (log.length > 0 ? log : [record]));
}

/**
 * Resolves with the records that were removed — taken inside the queue, so the
 * Undo snapshot includes appends the popup has not rendered yet.
 */
export async function clearRedirectLog(): Promise<RedirectRecord[]> {
  let cleared: RedirectRecord[] = [];
  await mutateLog((log) => {
    cleared = log;
    return [];
  });
  return cleared;
}

/** Undo of Clear: merge the snapshot back without dropping records captured after the clear. */
export function restoreRedirectRecords(records: RedirectRecord[]): Promise<void> {
  return mutateLog((log) => {
    const restoredIds = new Set(records.map((record) => record.id));
    return [...log.filter((record) => !restoredIds.has(record.id)), ...records].slice(0, MAX_RECORDS);
  });
}
