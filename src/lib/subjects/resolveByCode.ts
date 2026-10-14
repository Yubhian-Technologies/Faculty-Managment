import type { Firestore } from "firebase-admin/firestore";

export interface ResolveByCodeResult {
  // uppercased code -> subject id
  resolved: Map<string, string>;
  notFound: string[];
}

// Resolves typed subject codes (the Subjects tab's "assign by code" box) to
// master subject ids WITHOUT reading the whole regulation's subject pool -
// only docs matching `code in [...]` are read (a single-field "in" query,
// chunked at Firestore's 30-value cap; single-field queries are
// auto-indexed, so this needs no new composite index), then narrowed in
// memory to this regulation + catalog group. A code that happens to match
// an unrelated course/regulation elsewhere in the college is read but
// discarded, not assigned.
export async function resolveSubjectIdsByCode(
  db: Firestore,
  collegeId: string,
  regulation: string,
  courseIds: string[],
  codes: string[]
): Promise<ResolveByCodeResult> {
  const normalized = Array.from(new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean)));
  const courseIdSet = new Set(courseIds);
  const resolved = new Map<string, string>();
  const subjectsRef = db.collection("colleges").doc(collegeId).collection("subjects");

  for (let i = 0; i < normalized.length; i += 30) {
    const chunk = normalized.slice(i, i + 30);
    const snap = await subjectsRef.where("code", "in", chunk).get();
    for (const doc of snap.docs) {
      const data = doc.data() as { code?: string; regulation?: string; courseId?: string };
      if (!data.code || (data.regulation ?? "").trim() !== regulation) continue;
      if (!courseIdSet.has(data.courseId ?? "")) continue;
      const code = data.code.toUpperCase();
      if (!resolved.has(code)) resolved.set(code, doc.id);
    }
  }

  const notFound = normalized.filter((c) => !resolved.has(c));
  return { resolved, notFound };
}
