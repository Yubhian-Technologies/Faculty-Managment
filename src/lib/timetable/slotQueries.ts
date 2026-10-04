import type { DocumentReference, QueryDocumentSnapshot } from "firebase-admin/firestore";

/**
 * The timetable slots a clash check or a draft actually needs: every slot of ONE
 * section, plus every slot belonging to the given faculty (in any section). That is
 * all `busyFaculty`, a section's pinned slots and the publish clash re-check ever look
 * at - they only ever ask about the faculty named on this section's assignments.
 *
 * It replaces reading the college's WHOLE `timetableSlots` collection (every section,
 * every retained semester) on every generate, every drag-and-drop edit and every
 * publish, which cost tens of thousands of reads each time. Filtering by semester and
 * academic year still happens in the callers, exactly as before.
 */
export async function loadSlotsForSectionAndFaculty(
  collegeRef: DocumentReference,
  sectionId: string,
  facultyIds: Iterable<string>
): Promise<QueryDocumentSnapshot[]> {
  const slots = collegeRef.collection("timetableSlots");
  const ids = Array.from(new Set(Array.from(facultyIds).filter(Boolean)));
  const queries = [slots.where("sectionId", "==", sectionId).get()];
  // Firestore caps an `in` filter at 30 values.
  for (let i = 0; i < ids.length; i += 30) queries.push(slots.where("facultyId", "in", ids.slice(i, i + 30)).get());
  const snaps = await Promise.all(queries);
  const seen = new Set<string>();
  const out: QueryDocumentSnapshot[] = [];
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      out.push(doc);
    }
  }
  return out;
}
