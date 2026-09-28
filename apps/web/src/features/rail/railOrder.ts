import { http } from '../../lib/http';
import { toCluster } from '../../lib/normalize';
import type { Cluster } from '../../lib/types';
import { getState, setState } from '../../data/store';

export type RailItem = { kind: 'beacon'; id: string } | { kind: 'cluster'; cluster: Cluster };

const KEY = 'subspace_rail_order';

function readOrder(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}
function writeOrder(order: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    /* ignore */
  }
}

/** Top-level rail entries: beacons not in a cluster, and clusters, in the user's order. */
export function railItems(beaconOrder: string[], clusters: Cluster[]): RailItem[] {
  const clustered = new Set(clusters.flatMap((c) => c.beaconIds));
  const known = new Set(beaconOrder);
  const entries = new Map<string, RailItem>();
  for (const c of clusters) {
    const live = c.beaconIds.filter((id) => known.has(id));
    if (live.length) entries.set(`cluster:${c.id}`, { kind: 'cluster', cluster: { ...c, beaconIds: live } });
  }
  for (const id of beaconOrder) if (!clustered.has(id)) entries.set(`beacon:${id}`, { kind: 'beacon', id });

  const saved = readOrder().filter((k) => entries.has(k));
  const rest = [...entries.keys()].filter((k) => !saved.includes(k));
  return [...saved, ...rest].map((k) => entries.get(k)!);
}

export const railKey = (item: RailItem) => (item.kind === 'beacon' ? `beacon:${item.id}` : `cluster:${item.cluster.id}`);

export function moveRailItem(items: RailItem[], from: string, toIndex: number) {
  const keys = items.map(railKey).filter((k) => k !== from);
  keys.splice(Math.max(0, Math.min(toIndex, keys.length)), 0, from);
  writeOrder(keys);
  setState((s) => ({ beaconOrder: [...s.beaconOrder] })); // re-render the rail
}

// ---------------------------------------------------------------------------
// Cluster mutations (persisted via /clusters)
// ---------------------------------------------------------------------------

const upsertCluster = (c: Cluster) =>
  setState((s) => ({ clusters: [...s.clusters.filter((x) => x.id !== c.id), c].sort((a, b) => a.position - b.position) }));

async function removeFromClusters(beaconId: string, except?: string) {
  for (const c of getState().clusters) {
    if (c.id === except || !c.beaconIds.includes(beaconId)) continue;
    const beaconIds = c.beaconIds.filter((id) => id !== beaconId);
    if (beaconIds.length === 0) await deleteCluster(c.id);
    else {
      upsertCluster({ ...c, beaconIds });
      await http.patch(`/clusters/${c.id}`, { beaconIds });
    }
  }
}

/** Drop beacon `dragged` onto beacon `target`: create a cluster holding both. */
export async function groupBeacons(target: string, dragged: string, items: RailItem[]) {
  if (target === dragged) return;
  const targetIndex = items.findIndex((i) => i.kind === 'beacon' && i.id === target);
  await removeFromClusters(dragged);
  const res = await http.post<{ cluster: any }>('/clusters', { name: 'New Cluster', beaconIds: [target, dragged] });
  const cluster = toCluster(res.cluster);
  upsertCluster(cluster);
  const keys = items.map(railKey).filter((k) => k !== `beacon:${dragged}` && k !== `beacon:${target}`);
  keys.splice(Math.max(0, targetIndex), 0, `cluster:${cluster.id}`);
  writeOrder(keys);
}

export async function addToCluster(clusterId: string, beaconId: string, index?: number) {
  const c = getState().clusters.find((x) => x.id === clusterId);
  if (!c) return;
  await removeFromClusters(beaconId, clusterId);
  const ids = c.beaconIds.filter((id) => id !== beaconId);
  ids.splice(index ?? ids.length, 0, beaconId);
  upsertCluster({ ...c, beaconIds: ids });
  await http.patch(`/clusters/${clusterId}`, { beaconIds: ids });
}

/** Move a beacon out of any cluster to a top-level rail position. */
export async function ungroupBeacon(beaconId: string, items: RailItem[], toIndex: number) {
  await removeFromClusters(beaconId);
  moveRailItem(railItems(getState().beaconOrder, getState().clusters), `beacon:${beaconId}`, toIndex);
  void items;
}

export async function updateCluster(id: string, patch: Partial<Pick<Cluster, 'name' | 'color'>>) {
  const c = getState().clusters.find((x) => x.id === id);
  if (!c) return;
  upsertCluster({ ...c, ...patch });
  await http.patch(`/clusters/${id}`, patch);
}

export async function deleteCluster(id: string) {
  setState((s) => ({ clusters: s.clusters.filter((c) => c.id !== id) }));
  await http.delete(`/clusters/${id}`);
}
