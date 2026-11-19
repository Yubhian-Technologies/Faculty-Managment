import type { Firestore } from "firebase-admin/firestore";
import { nowInIndia } from "@/lib/leave/dayCounter";

// Principal dashboard extras (the shared today / semester figures come from hodDashboardServer.ts with the whole
// college as scope). Faculty attendance this month by department: of the days with an attendance record, the share
// present (present, half day or on duty) - read from the same attendanceRecords the attendance report shows.

const cache = new Map<string, { at: number; value: Awaited<ReturnType<typeof compute>> }>();

export async function loadFacultyMonth(db: Firestore, collegeId: string) {
  const hit = cache.get(collegeId);
  if (hit && Date.now() - hit.at < 10 * 60_000 && !process.env.FIRESTORE_EMULATOR_HOST) return hit.value;
  const value = await compute(db, collegeId);
  cache.set(collegeId, { at: Date.now(), value });
  return value;
}

const IN = new Set(["PRESENT", "HALF_DAY", "ON_DUTY"]);

async function compute(db: Firestore, collegeId: string) {
  const today = nowInIndia().dateISO;
  const from = `${today.slice(0, 8)}01`;
  const snap = await db.collection("colleges").doc(collegeId).collection("attendanceRecords")
    .where("dateKey", ">=", from).where("dateKey", "<=", today).select("department", "status").get();
  const by = new Map<string, { present: number; marked: number }>();
  for (const d of snap.docs) {
    const department = String(d.get("department") ?? "").trim();
    const status = String(d.get("status") ?? "");
    if (!department || !(IN.has(status) || status === "ABSENT")) continue;
    const cur = by.get(department) ?? { present: 0, marked: 0 };
    cur.marked += 1;
    if (IN.has(status)) cur.present += 1;
    by.set(department, cur);
  }
  return {
    month: today.slice(0, 7),
    departments: [...by.entries()]
      .map(([department, v]) => ({ department, ...v, pct: v.marked ? Math.round((v.present / v.marked) * 1000) / 10 : null }))
      .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101)),
  };
}
