import { browser } from 'wxt/browser';
import type { RedirectRecord } from '../shared/types/redirect';
import { MAX_RECORDS, REDIRECT_LOG_KEY } from './helpers';

let writeQueue: Promise<void> = Promise.resolve();

/**
 * Prepend a record to the persisted log. Appends are serialized: the log is a
 * read-modify-write of one storage key, so two records finalized at the same
 * moment (e.g. a probe timeout finalizing several chains) would otherwise
 * overwrite each other and one would be lost.
 */
export function appendRedirectRecord(record: RedirectRecord): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    try {
      const { [REDIRECT_LOG_KEY]: existing = [] } = await browser.storage.local.get(REDIRECT_LOG_KEY);
      const updated = [record, ...(existing as RedirectRecord[])].slice(0, MAX_RECORDS);
      await browser.storage.local.set({ [REDIRECT_LOG_KEY]: updated });
    } catch (error) {
      console.error('Failed to append redirect record', error);
    }
  });
  return writeQueue;
}
