import type { Firestore } from "firebase-admin/firestore";
import type { ClassAdjustment } from "@/types";
import type { LegInForce } from "./rules";

// The class adjustments in force (ACCEPTED) on a date - read by lib/timetable/currentPeriod.ts so a faculty
// member's day (Mark Attendance, completion reports, the not-posted sweep) and the attendance write gate follow
// them. One equality query per date; identical reads within 15 s share one result (the write gate passes `fresh`).

const TTL_MS = 15_000;
const MAX_KEYS = 200;
const cache = new Map<string, { at: number; value: Promise<LegInForce[]> }>();

export function invalidateClassAdjustmentCache(collegeId?: string): void {
  if (!collegeId) { cache.clear(); return; }
  for (const key of cache.keys()) if (key.startsWith(`${collegeId}|`)) cache.delete(key);
}

async function load(db: Firestore, collegeId: string, date: string): Promise<LegInForce[]> {
  const snap = await db.collection("colleges").doc(collegeId).collection("classAdjustments").where("date", "==", date).get();
  const out: LegInForce[] = [];
  for (const d of snap.docs) {
    const a = d.data() as ClassAdjustment;
    if (a.status !== "ACCEPTED") continue;
    for (const leg of a.legs ?? []) out.push({ ...leg, adjustmentId: d.id });
  }
  return out;
}

export async function classAdjustmentLegsOn(db: Firestore, collegeId: string, date: string, opts: { fresh?: boolean } = {}): Promise<LegInForce[]> {
  const key = `${collegeId}|${date}`;
  const now = Date.now();
  if (!opts.fresh) {
    const hit = cache.get(key);
    if (hit && now - hit.at < TTL_MS) return hit.value;
  }
  const value = load(db, collegeId, date);
  if (cache.size >= MAX_KEYS) cache.clear();
  cache.set(key, { at: now, value });
  value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
  return value;
}
