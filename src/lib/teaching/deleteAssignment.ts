import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { notify } from "@/lib/notify";
import { bumpGuards, lockGuards, sectionGuard } from "@/lib/timetable/guards";
import { allocationFields, requestAllocations } from "@/lib/teaching/requestAllocations";
import type { FacultyAssignmentRequest } from "@/types";

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

  const removed = await db.runTransaction(async (tx) => {
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
  if (removed) await reopenAllocatedRequests(db, collegeId, assignmentId);
  return removed;
}

// A faculty-assignment request that was allocated to this assignment would
// otherwise stay "Allocated" pointing at nothing: the requester sees no subject
// to place, and the lender can't allocate again (only PENDING requests can be
// acted on). Sent back to PENDING so it shows up in the lender's queue again.
// Best-effort and outside the transaction above - the delete must never fail
// because of it, and a request left stale can be fixed by scripts/repair-orphaned-assignment-requests.mjs.
async function reopenAllocatedRequests(db: Firestore, collegeId: string, assignmentId: string): Promise<void> {
  try {
    const collegeRef = db.collection("colleges").doc(collegeId);
    const requests = collegeRef.collection("facultyAssignmentRequests");
    // A request may hold several allocated faculty (teachingAssignmentIds), or be
    // an older single-faculty one (teachingAssignmentId only) - find both.
    const [byList, byFirst] = await Promise.all([
      requests.where("teachingAssignmentIds", "array-contains", assignmentId).get(),
      requests.where("teachingAssignmentId", "==", assignmentId).get(),
    ]);
    const docs = new Map([...byList.docs, ...byFirst.docs].map((d) => [d.id, d]));
    for (const d of docs.values()) {
      const r = d.data() as FacultyAssignmentRequest;
      if (r.status !== "ALLOCATED") continue;
      const remaining = requestAllocations(r).filter((a) => a.teachingAssignmentId !== assignmentId);
      // Other faculty are still allocated: only this one leaves the request.
      if (remaining.length > 0) {
        await d.ref.update({ ...allocationFields(remaining), updatedAt: new Date() });
        continue;
      }
      await d.ref.update({
        status: "PENDING",
        allocations: FieldValue.delete(),
        allocatedFacultyIds: FieldValue.delete(),
        teachingAssignmentIds: FieldValue.delete(),
        allocatedFacultyId: FieldValue.delete(),
        allocatedFacultyName: FieldValue.delete(),
        allocatedBy: FieldValue.delete(),
        teachingAssignmentId: FieldValue.delete(),
        busyPeriods: FieldValue.delete(),
        busyClosed: FieldValue.delete(),
        busyClosedAt: FieldValue.delete(),
        updatedAt: new Date(),
      });
      if (!r.targetDepartmentId) continue;
      const deptSnap = await collegeRef.collection("departments").doc(r.targetDepartmentId).get();
      const hodUid = (deptSnap.data() as { hodUid?: string } | undefined)?.hodUid;
      if (hodUid) {
        await notify(
          db, collegeId, hodUid, "FACULTY_ASSIGNMENT_REQUESTED",
          "Faculty assignment request reopened",
          `The assignment for ${r.subjectName} (Section ${r.sectionName}) was removed, so ${r.requestedByName ?? "the requester"}'s request to ${r.targetDepartmentName} is pending again`,
          "/hod/assignment-requests",
        );
      }
    }
  } catch (err) {
    console.error("[deleteAssignmentWithSlots] could not reopen the linked assignment request", err);
  }
}
