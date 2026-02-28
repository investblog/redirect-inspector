import { browser } from 'wxt/browser';

/**
 * Shorthand for browser.i18n.getMessage().
 * Synchronous — safe for DOM rendering hot paths.
 * Falls back to the key name when a message is missing (dev aid).
 */
export function t(key: string, ...substitutions: string[]): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- key is dynamic, WXT generates strict overloads per key
  const msg = browser.i18n.getMessage(key as any, substitutions.length > 0 ? substitutions : undefined);
  return msg || key;
}

/**
 * Plural-aware i18n helper.
 * Selects between singular (count===1) and plural key,
 * passing count as the $1 substitution.
 */
export function tPlural(count: number, oneKey: string, otherKey: string): string {
  const key = count === 1 ? oneKey : otherKey;
  return t(key, String(count));
}
