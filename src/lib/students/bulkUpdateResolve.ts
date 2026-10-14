import type { Firestore } from "firebase-admin/firestore";
import { classifyBulkUpdate, type BulkStudent, type BulkUpdateResult, type BulkUpdateRow } from "./bulkUpdate";
import { normalizeStudentMobile, STUDENT_MOBILE_KEYS, studentMobileProblem } from "./studentMobile";

const IN_LIMIT = 30; // Firestore "in" takes at most 30 values

/**
 * Finds the students the file's mobile numbers belong to and runs the classifier. Used by BOTH the preview and the
 * apply endpoint - apply calls it again on fresh data rather than trusting what the preview showed.
 *
 * Reads are targeted: `mobileNo in [...]` (stored values are the normalised 10 digits - verified on live data). Numbers
 * that query does not find are then searched for in the whole roster by their normalised form, so a legacy record saved
 * as "+91 98765 43210" is still found (and is never mistaken for "no such student"). Only that fallback scans the
 * college, and only when something was not found.
 */
export async function resolveBulkUpdate(
  db: Firestore,
  collegeId: string,
  rows: BulkUpdateRow[],
  fields: string[],
  fillOnly: boolean
): Promise<BulkUpdateResult[]> {
  const students = db.collection("colleges").doc(collegeId).collection("students");
  const wanted = Array.from(new Set(rows.filter((r) => !studentMobileProblem(r.mobile)).map((r) => normalizeStudentMobile(r.mobile))));
  const byMobile = new Map<string, BulkStudent[]>();

  const add = (id: string, data: Record<string, unknown>) => {
    const m = normalizeStudentMobile(data.mobileNo);
    if (!m) return;
    const list = byMobile.get(m) ?? [];
    if (!list.some((s) => s.id === id)) list.push({ id, data });
    byMobile.set(m, list);
  };

  for (let i = 0; i < wanted.length; i += IN_LIMIT) {
    const snap = await students.where("mobileNo", "in", wanted.slice(i, i + IN_LIMIT)).get();
    for (const d of snap.docs) add(d.id, d.data() as Record<string, unknown>);
  }

  const missing = wanted.filter((m) => !byMobile.has(m));
  if (missing.length > 0) {
    const wantedSet = new Set(missing);
    const light = await students.select("mobileNo").get();
    const hits = light.docs.filter((d) => wantedSet.has(normalizeStudentMobile(d.get("mobileNo"))));
    for (let i = 0; i < hits.length; i += 100) {
      const full = await db.getAll(...hits.slice(i, i + 100).map((d) => d.ref));
      for (const d of full) if (d.exists) add(d.id, d.data() as Record<string, unknown>);
    }
  }

  // Numbers still unknown here: is one registered to a student of ANOTHER college? (Only to word the message - such a
  // student is never touched from this college.)
  const otherCollegeMobiles = new Set<string>();
  const unknown = wanted.filter((m) => !byMobile.has(m));
  if (unknown.length > 0) {
    const claims = await db.getAll(...unknown.map((m) => db.collection(STUDENT_MOBILE_KEYS).doc(m)));
    claims.forEach((c, i) => {
      const owner = c.exists ? (c.get("collegeId") as string | undefined) : undefined;
      if (owner && owner !== collegeId) otherCollegeMobiles.add(unknown[i]);
    });
  }

  return classifyBulkUpdate({ rows, studentsByMobile: byMobile, otherCollegeMobiles, fields, fillOnly });
}
