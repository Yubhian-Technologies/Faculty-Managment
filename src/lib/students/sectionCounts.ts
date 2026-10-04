import type { Firestore } from "firebase-admin/firestore";

// Enrolled students per (department, section, year, cross-listed department, course) for the
// Sections list. Counting means reading every student document of the departments listed, and
// 23 screens call that list, so the finished count map is shared for a short time instead of
// being rebuilt on each call. Routes that add, move, promote or delete students call
// invalidateSectionCountCache so their own next list is fresh; elsewhere a count can lag by
// at most the TTL.

const TTL_MS = 60_000;
const MAX_ENTRIES = 40;
const cache = new Map<string, { at: number; value: Promise<Map<string, number>> }>();

export function invalidateSectionCountCache(collegeId?: string): void {
  if (!collegeId) { cache.clear(); return; }
  for (const key of cache.keys()) if (key.startsWith(`${collegeId}|`)) cache.delete(key);
}

export function getSectionStudentCounts(db: Firestore, collegeId: string, deptNames: string[]): Promise<Map<string, number>> {
  const key = `${collegeId}|${[...deptNames].sort().join(",")}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;

  const value = countStudents(db, collegeId, deptNames);
  if (cache.size >= MAX_ENTRIES) {
    for (const [k, v] of cache) if (now - v.at >= TTL_MS) cache.delete(k);
    if (cache.size >= MAX_ENTRIES) cache.clear();
  }
  cache.set(key, { at: now, value });
  value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
  return value;
}

async function countStudents(db: Firestore, collegeId: string, deptNames: string[]): Promise<Map<string, number>> {
  const chunks: string[][] = [];
  for (let i = 0; i < deptNames.length; i += 30) chunks.push(deptNames.slice(i, i + 30));
  const students = db.collection("colleges").doc(collegeId).collection("students");

  const [primaryStudentSnaps, secondaryStudentSnaps] = await Promise.all([
    Promise.all(chunks.map((chunk) => students.where("department", "in", chunk).get())),
    Promise.all(chunks.map((chunk) => students.where("secondaryDepartment", "in", chunk).get())),
  ]);

  const countMap = new Map<string, number>();
  const countedIds = new Set<string>();
  for (const snap of primaryStudentSnaps) {
    for (const d of snap.docs) {
      if (countedIds.has(d.id)) continue;
      countedIds.add(d.id);
      const s = d.data() as { department?: string; section?: string; year?: number; secondaryDepartment?: string; courseId?: string };
      const key = `${s.department ?? ""}|${s.section ?? ""}|${s.year ?? 0}|${(s.secondaryDepartment ?? "").toLowerCase()}|${s.courseId ?? ""}`;
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
    }
  }
  for (const snap of secondaryStudentSnaps) {
    for (const d of snap.docs) {
      if (countedIds.has(d.id)) continue;
      countedIds.add(d.id);
      const s = d.data() as { secondaryDepartment?: string; section?: string; year?: number; courseId?: string };
      // The section a shared-first-year student actually sits in is their real branch's own - never
      // itself cross-listed (see hod/sections/new's managed-branch mode) - so the disambiguator
      // stays "", same as such a section's own (always-empty) secondaryDepartments.
      const key = `${s.secondaryDepartment ?? ""}|${s.section ?? ""}|${s.year ?? 0}|${""}|${s.courseId ?? ""}`;
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
    }
  }
  return countMap;
}
