import type { Classification, RedirectRecord } from '../../shared/types/redirect';

// ---- Constants ----

export const NOISE_CLASSIFICATIONS = new Set<Classification>(['likely-tracking', 'likely-media']);

const SESSION_WINDOW_MS = 60_000;

// ---- Types ----

export interface SessionGroup {
  tabId: number;
  primary: RedirectRecord;
  satellites: RedirectRecord[];
}

// ---- Helpers ----

export function recordTimestamp(record: RedirectRecord): number {
  if (record.initiatedAt) {
    const t = new Date(record.initiatedAt).getTime();
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

function isNoise(record: RedirectRecord): boolean {
  return NOISE_CLASSIFICATIONS.has(record.classification!);
}

function hopCount(record: RedirectRecord): number {
  return Array.isArray(record.events) ? record.events.length : 0;
}

/**
 * Primary selection comparator: non-noise before noise → more hops first → earliest first.
 * Returns negative if `a` should be preferred over `b`.
 */
function primaryComparator(a: RedirectRecord, b: RedirectRecord): number {
  const aNoise = isNoise(a) ? 1 : 0;
  const bNoise = isNoise(b) ? 1 : 0;
  if (aNoise !== bNoise) return aNoise - bNoise;

  const aHops = hopCount(a);
  const bHops = hopCount(b);
  if (aHops !== bHops) return bHops - aHops;

  return recordTimestamp(a) - recordTimestamp(b);
}

function selectPrimary(records: RedirectRecord[]): RedirectRecord {
  const sorted = records.slice().sort(primaryComparator);
  return sorted[0];
}

// ---- Domain affinity ----

function getHost(url: string | undefined): string {
  try {
    return new URL(url!).host;
  } catch {
    return '';
  }
}

/** Collect every host that appears in a record's URLs (initial, final, events, initiator). */
function getChainHosts(record: RedirectRecord): Set<string> {
  const hosts = new Set<string>();
  const add = (url: string | undefined) => {
    const h = getHost(url);
    if (h) hosts.add(h);
  };
  add(record.initialUrl);
  add(record.finalUrl);
  add(record.initiator);
  if (Array.isArray(record.events)) {
    for (const ev of record.events) {
      add(ev.from);
      add(ev.to);
    }
  }
  return hosts;
}

function hasHostOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const h of a) {
    if (b.has(h)) return true;
  }
  return false;
}

// ---- Cluster partitioning ----

/** Recursively partition records by domain affinity: pick primary, collect related satellites, re-partition leftovers. */
function partitionByAffinity(records: RedirectRecord[], tabId: number, out: SessionGroup[]): void {
  if (records.length === 0) return;
  if (records.length === 1) {
    out.push({ tabId, primary: records[0], satellites: [] });
    return;
  }

  const primary = selectPrimary(records);
  const primaryHosts = getChainHosts(primary);
  const related: RedirectRecord[] = [];
  const unrelated: RedirectRecord[] = [];

  for (const r of records) {
    if (r === primary) continue;
    if (hasHostOverlap(primaryHosts, getChainHosts(r))) {
      related.push(r);
    } else {
      unrelated.push(r);
    }
  }

  out.push({ tabId, primary, satellites: related });
  partitionByAffinity(unrelated, tabId, out);
}

// ---- Grouping ----

/**
 * Build session groups from redirect records.
 *
 * - Pending records are always singletons
 * - tabId 0 or -1 are always singletons
 * - Completed records are bucketed by tabId, then clustered by 60s time window
 * - Within each cluster, a primary is selected (non-noise preferred, most hops, earliest)
 * - Noise satellites/groups are hidden when showingNoise is false
 */
export function buildSessionGroups(records: RedirectRecord[], showingNoise: boolean): SessionGroup[] {
  const safeRecords = Array.isArray(records) ? records : [];
  const singletons: SessionGroup[] = [];
  const buckets = new Map<number, RedirectRecord[]>();

  for (const record of safeRecords) {
    // Pending records → always singleton
    if (record.pending) {
      singletons.push({ tabId: record.tabId, primary: record, satellites: [] });
      continue;
    }

    // No-tab context → singleton
    if (record.tabId === -1 || record.tabId === 0) {
      singletons.push({ tabId: record.tabId, primary: record, satellites: [] });
      continue;
    }

    // Bucket by tabId
    let bucket = buckets.get(record.tabId);
    if (!bucket) {
      bucket = [];
      buckets.set(record.tabId, bucket);
    }
    bucket.push(record);
  }

  // Process each bucket into clusters
  const completedGroups: SessionGroup[] = [];

  for (const [tabId, bucket] of buckets) {
    // Sort by initiatedAt ascending
    bucket.sort((a, b) => recordTimestamp(a) - recordTimestamp(b));

    // Cluster by 60s time window
    const clusters: RedirectRecord[][] = [];
    let currentCluster: RedirectRecord[] = [];

    for (const record of bucket) {
      if (currentCluster.length === 0) {
        currentCluster.push(record);
        continue;
      }

      const lastTs = recordTimestamp(currentCluster[currentCluster.length - 1]);
      const curTs = recordTimestamp(record);

      if (curTs - lastTs <= SESSION_WINDOW_MS) {
        currentCluster.push(record);
      } else {
        clusters.push(currentCluster);
        currentCluster = [record];
      }
    }
    if (currentCluster.length > 0) {
      clusters.push(currentCluster);
    }

    // Per cluster: recursively partition by domain affinity
    for (const cluster of clusters) {
      partitionByAffinity(cluster, tabId, completedGroups);
    }
  }

  // Filter noise when showingNoise is false
  let groups: SessionGroup[];
  if (showingNoise) {
    groups = [...singletons, ...completedGroups];
  } else {
    const filtered: SessionGroup[] = [];

    for (const group of singletons) {
      if (!isNoise(group.primary)) {
        filtered.push(group);
      }
    }

    for (const group of completedGroups) {
      // Skip entire group if primary is noise
      if (isNoise(group.primary)) continue;

      // Filter noise satellites
      const filteredSatellites = group.satellites.filter((r) => !isNoise(r));
      filtered.push({ tabId: group.tabId, primary: group.primary, satellites: filteredSatellites });
    }

    groups = filtered;
  }

  // Sort: pending first (newest first), then completed (newest primary first)
  groups.sort((a, b) => {
    const aPending = a.primary.pending ? 1 : 0;
    const bPending = b.primary.pending ? 1 : 0;
    if (aPending !== bPending) return bPending - aPending;

    return recordTimestamp(b.primary) - recordTimestamp(a.primary);
  });

  return groups;
}
