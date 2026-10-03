import type { Firestore } from "firebase-admin/firestore";
import { bumpGuards, lockGuards, sectionGuard } from "@/lib/timetable/guards";

// Removing a teaching assignment removes its timetable slots with it. Both
// deletes route handlers (DELETE /teaching-assignments?id= and
// DELETE /teaching-assignments/[id]) did this as "read the slots, then batch
// delete" - a slot pinned to the assignment between the read and the commit
// (timetable-slots POST) was left behind pointing at an assignment that no
// longer exists. Done in one transaction under the section's guard document
// (lib/timetable/guards.ts) it serialises with slot creation in that section
// instead. Both routes now share this one implementation.

export interface DeletedAssignment {
  id: string;
  data: Record<string, unknown>;
  slotCount: number;
}

/** Deletes the assignment and its slots atomically. Returns null when it does not exist (already gone). */
export async function deleteAssignmentWithSlots(
  db: Firestore,
  collegeId: string,
  assignmentId: string,
  writer: string
): Promise<DeletedAssignment | null> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const ref = collegeRef.collection("teachingAssignments").doc(assignmentId);

  // The section is only known from the document itself.
  const peek = await ref.get();
  if (!peek.exists) return null;
  const sectionId = (peek.data() as { sectionId?: string }).sectionId;
  const guards = sectionId ? [sectionGuard(db, collegeId, sectionId)] : [];

  return db.runTransaction(async (tx) => {
    await lockGuards(tx, guards);
    const [snap, slots] = await Promise.all([
      tx.get(ref),
      tx.get(collegeRef.collection("timetableSlots").where("assignmentId", "==", assignmentId)),
    ]);
    if (!snap.exists) return null;
    for (const d of slots.docs) tx.delete(d.ref);
    tx.delete(ref);
    bumpGuards(tx, guards, writer);
    return { id: assignmentId, data: (snap.data() ?? {}) as Record<string, unknown>, slotCount: slots.docs.length };
  });
}
