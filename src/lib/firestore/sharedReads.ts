import type { DocumentData, Firestore } from "firebase-admin/firestore";

/** Like Promise.all(items.map(fn)), but at most `limit` run at once; results keep the input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker));
  return out;
}

// departments / courses are read whole by several hot routes just to resolve
// lookups, and change rarely. Cached per server instance for a few seconds, so
// a burst of requests reads each once. Callers must treat data() as read-only.
// ponytail: per-instance only - an edit shows up everywhere within TTL_MS, not instantly.
const TTL_MS = 20_000;
const MAX_ENTRIES = 50;
type CachedDoc = { id: string; data: () => DocumentData };
const cache = new Map<string, { at: number; value: Promise<CachedDoc[]> }>();

export function cachedCollectionDocs(db: Firestore, collegeId: string, name: "departments" | "courses"): Promise<CachedDoc[]> {
  const key = `${collegeId}/${name}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const value = db.collection("colleges").doc(collegeId).collection(name).get()
    .then((snap) => snap.docs.map((d) => { const data = d.data(); return { id: d.id, data: () => data }; }));
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
  return value;
}

// Any slow read several requests need at about the same time (one page opening sends them together), kept per
// server instance for `ttlMs`; requests made while it loads share the same read. A failed read is not kept.
// Only for pages that show data - a write must always decide on a fresh read.
const valueCache = new Map<string, { at: number; value: Promise<unknown> }>();
const MAX_VALUES = 200;

export function cachedValue<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = valueCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load();
  if (valueCache.size >= MAX_VALUES) valueCache.clear();
  valueCache.set(key, { at: Date.now(), value });
  value.catch(() => { if (valueCache.get(key)?.value === value) valueCache.delete(key); });
  return value;
}
