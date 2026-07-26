/**
 * 301.sh news — background side: alarm-driven feed polling and notifications.
 *
 * Enable flow (from a message sent by popup/welcome after the user granted the
 * optional `notifications` permission): seed the seen-set with every current
 * slug so the backlog is never pushed, then start a periodic alarm. Each tick
 * fetches the feed and notifies about unseen posts (newest first, capped).
 */

import { browser } from 'wxt/browser';
import {
  getNewsEnabled,
  hasNotificationsPermission,
  NEWS_ALARM_NAME,
  NEWS_ALARM_PERIOD_MINUTES,
  NEWS_FEED_URL,
  NEWS_NOTIF_URLS_KEY,
  NEWS_SEEDED_KEY,
  NEWS_SEEN_KEY,
  type NewsPost,
} from '../shared/news';

/** Max notifications per check — a burst of posts becomes at most this many toasts. */
const MAX_NOTIFICATIONS_PER_CHECK = 3;
/** Caps for stored state so it cannot grow unbounded over years of feed history. */
const MAX_SEEN_SLUGS = 300;
const MAX_NOTIF_URL_ENTRIES = 20;

async function fetchPosts(): Promise<NewsPost[]> {
  const response = await fetch(NEWS_FEED_URL, { headers: { 'cache-control': 'no-cache' } });
  if (!response.ok) {
    throw new Error(`news feed: HTTP ${response.status}`);
  }
  const data = (await response.json()) as { posts?: NewsPost[] };
  return Array.isArray(data.posts) ? data.posts.filter((post) => post?.slug && post?.url) : [];
}

async function getSeenSlugs(): Promise<Set<string>> {
  const result = await browser.storage.local.get({ [NEWS_SEEN_KEY]: [] });
  const stored = result[NEWS_SEEN_KEY];
  return new Set(Array.isArray(stored) ? (stored as string[]) : []);
}

async function saveSeenSlugs(slugs: Set<string>): Promise<void> {
  await browser.storage.local.set({ [NEWS_SEEN_KEY]: Array.from(slugs).slice(-MAX_SEEN_SLUGS) });
}

async function notifyPost(post: NewsPost): Promise<void> {
  const notifications = (browser as any).notifications;
  if (!notifications?.create) {
    return;
  }

  const notifId = `news-${post.slug}`;
  try {
    // Persist the click target BEFORE creating the toast — a fast click must not
    // race an unwritten map. Cap the map so dismissed entries can't pile up.
    const stored = await browser.storage.local.get({ [NEWS_NOTIF_URLS_KEY]: {} });
    const urls = { ...(stored[NEWS_NOTIF_URLS_KEY] as Record<string, string>), [notifId]: post.url };
    const keys = Object.keys(urls);
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_NOTIF_URL_ENTRIES))) {
      delete urls[key];
    }
    await browser.storage.local.set({ [NEWS_NOTIF_URLS_KEY]: urls });

    await notifications.create(notifId, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icons/128.png'),
      title: post.title,
      message: (post.description || '').slice(0, 200),
    });
  } catch (error) {
    console.warn('Failed to create news notification', error);
  }
}

async function removeNotifUrl(notifId: string): Promise<string | undefined> {
  const stored = await browser.storage.local.get({ [NEWS_NOTIF_URLS_KEY]: {} });
  const urls = stored[NEWS_NOTIF_URLS_KEY] as Record<string, string>;
  const url = urls[notifId];
  if (url !== undefined) {
    delete urls[notifId];
    await browser.storage.local.set({ [NEWS_NOTIF_URLS_KEY]: urls });
  }
  return url;
}

/**
 * One feed check. With `seedOnly` every current slug is marked seen without
 * notifying — used right after the user enables the feature. Returns whether
 * the feed was fetched successfully.
 */
export async function checkNews(options: { seedOnly?: boolean } = {}): Promise<boolean> {
  try {
    // Without the permission nothing can ever be shown — skip the fetch
    // entirely (the enabled flag roams via storage.sync, the grant does not).
    const canNotify = await hasNotificationsPermission();
    if (!options.seedOnly && !canNotify) {
      return false;
    }

    const posts = await fetchPosts();

    const seen = await getSeenSlugs();
    // Feed order is oldest -> newest; reverse so the cap keeps the newest posts.
    const unseen = posts.filter((post) => !seen.has(post.slug)).reverse();

    // A failed enable-time seed leaves the flag unset; the first successful
    // tick then seeds silently instead of notifying about the whole backlog.
    const seededResult = await browser.storage.local.get({ [NEWS_SEEDED_KEY]: false });
    const seeding = options.seedOnly || !seededResult[NEWS_SEEDED_KEY];

    if (!seeding && canNotify) {
      for (const post of unseen.slice(0, MAX_NOTIFICATIONS_PER_CHECK)) {
        await notifyPost(post);
      }
    }

    if (unseen.length > 0) {
      for (const post of unseen) {
        seen.add(post.slug);
      }
      await saveSeenSlugs(seen);
    }
    await browser.storage.local.set({ [NEWS_SEEDED_KEY]: true });
    return true;
  } catch (error) {
    console.warn('News check failed', error);
    return false;
  }
}

async function ensureNewsAlarm(): Promise<void> {
  // alarms.create with an existing name RESTARTS the countdown; the SW is woken
  // constantly by webRequest, so an unconditional create would never let the
  // period elapse. Create only when absent.
  const existing = await browser.alarms.get(NEWS_ALARM_NAME);
  if (!existing) {
    await browser.alarms.create(NEWS_ALARM_NAME, { periodInMinutes: NEWS_ALARM_PERIOD_MINUTES });
  }
}

export async function enableNewsAlarm(): Promise<void> {
  registerNotificationListeners();
  await browser.storage.local.set({ [NEWS_SEEDED_KEY]: false });
  await checkNews({ seedOnly: true });
  await ensureNewsAlarm();
}

export async function disableNewsAlarm(): Promise<void> {
  await browser.alarms.clear(NEWS_ALARM_NAME);
}

let notificationListenersRegistered = false;

/**
 * Idempotent; safe to call again once the optional permission is granted.
 * Needed because on Firefox's persistent background page the `notifications`
 * namespace is absent at startup until the user grants the permission —
 * without a re-registration hook, clicks would be dead until browser restart.
 */
function registerNotificationListeners(): void {
  if (notificationListenersRegistered) {
    return;
  }
  const notifications = (browser as any).notifications;
  if (!notifications?.onClicked) {
    return;
  }
  notificationListenersRegistered = true;

  notifications.onClicked.addListener((notifId: string) => {
    void (async () => {
      const url = await removeNotifUrl(notifId);
      if (url) {
        await browser.tabs.create({ url });
      }
      notifications.clear?.(notifId);
    })();
  });

  // Prune dismissed/expired toasts so the click map only ever holds live ones.
  notifications.onClosed?.addListener((notifId: string) => {
    void removeNotifUrl(notifId);
  });
}

/** Register listeners and restore the alarm after browser/SW restarts. */
export function setupNews(): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === NEWS_ALARM_NAME) {
      void checkNews();
    }
  });

  registerNotificationListeners();
  (browser as any).permissions?.onAdded?.addListener((added: { permissions?: string[] }) => {
    if (added.permissions?.includes('notifications')) {
      registerNotificationListeners();
    }
  });

  void getNewsEnabled().then((enabled) => {
    if (enabled) {
      void ensureNewsAlarm();
    }
  });
}
