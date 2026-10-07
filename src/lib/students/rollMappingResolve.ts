import type { Firestore } from "firebase-admin/firestore";
import { studentRollKey } from "./loginDefaults";
import { registryRef } from "./rollIdentity";
import {
  classifyRollMapping,
  type ClassifyInput,
  type RollHolderLookup,
  type RollMapResult,
  type RollMapRow,
  type StudentForMapping,
} from "./rollMapping";

/**
 * Reads what the classifier needs and runs it.
 *
 * Both the preview endpoint and the apply endpoint call THIS - that is what
 * makes "what you were shown" and "what happens" the same thing. Apply calls it
 * again at write time rather than trusting the preview it was handed, because
 * another Office user may have claimed a roll in between.
 */
export async function resolveRollMapping(
  db: Firestore,
  collegeId: string,
  rows: RollMapRow[],
  replaceExisting: boolean
): Promise<RollMapResult[]> {
  const collegeRef = db.collection("colleges").doc(collegeId);

  // Every student in this college. The file is matched against these by mobile;
  // only a modest roster per college, and the whole set is needed because a
  // mobile cannot be queried on reliably (it is stored unnormalised on older
  // records).
  const studentsSnap = await collegeRef.collection("students").get();
  const students: StudentForMapping[] = studentsSnap.docs.map((d) => {
    const x = d.data() as { name?: string; rollNumber?: string; mobileNo?: unknown };
    return { id: d.id, name: x.name, rollNumber: x.rollNumber, mobileNo: x.mobileNo == null ? undefined : String(x.mobileNo) };
  });

  // The GLOBAL roll registry, for just the rolls in this file. Roll numbers are
  // unique across every college (see rollIdentity.ts), and a collection-group
  // query on the roll does not exist - the registry is keyed by document id, so
  // these are direct reads.
  //
  // Addressed through registryRef, NOT by rebuilding the id here: the document
  // id is studentRollKey(roll).toUpperCase() (see loginDefaults.studentRollDocId)
  // while the classifier keys on the lowercase studentRollKey. Reconstructing it
  // by hand got that wrong and silently found no holders at all, which would
  // have disabled the "roll already taken" check completely.
  const rollsByKey = new Map<string, string>();
  for (const r of rows) {
    const key = studentRollKey(r.roll ?? "");
    if (key && !rollsByKey.has(key)) rollsByKey.set(key, (r.roll ?? "").trim());
  }
  const rollHolderByKey = new Map<string, RollHolderLookup>();
  const entries = [...rollsByKey.entries()];
  if (entries.length > 0) {
    const snaps = await db.getAll(...entries.map(([, roll]) => registryRef(db, roll)));
    snaps.forEach((snap, i) => {
      if (!snap.exists) return;
      const d = snap.data() as { active?: boolean; name?: string; collegeId?: string; studentDocId?: string };
      // A retired entry is not a holder - that roll is free to claim again.
      if (d.active === false) return;
      rollHolderByKey.set(entries[i][0], {
        name: d.name,
        sameCollege: d.collegeId === collegeId,
        studentDocId: d.studentDocId,
      });
    });
  }

  const input: ClassifyInput = { rows, students, rollHolderByKey, replaceExisting };
  return classifyRollMapping(input);
}
