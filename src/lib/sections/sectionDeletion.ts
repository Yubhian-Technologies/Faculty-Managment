import type { Firestore } from "firebase-admin/firestore";
import { deleteInOrder } from "@/lib/firestore/orderedCommit";
import { MAX_OPS_PER_BATCH } from "@/lib/firestore/chunkedBatch";
import { getInChunks } from "@/lib/firestore/inQuery";

// Deleting a section. Two separate concerns:
//
// 1. HISTORY. A section that has been taught has attendance sessions and
//    possibly internal marks hanging off its id (and its assignments' ids).
//    Deleting it strands that record - it can never be reported on again - so
//    such a section is refused outright rather than deleted. (An archive state
//    would be the alternative; the app has none, and inventing one is a
//    product decision.)
//
// 2. CASCADE. Its teaching assignments, published slots and draft are unreachable
//    any other way, so they go with it. Done so a failure cannot orphan them:
//    children first, the section itself last, one committed chunk at a time -
//    and a final sweep for anything created while the delete was running.

export interface SectionHistory {
  attendanceSessions: boolean;
  internalMarks: boolean;
}

export async function findSectionHistory(db: Firestore, collegeId: string, sectionId: string): Promise<SectionHistory> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const assignmentIds = (await collegeRef.collection("teachingAssignments").where("sectionId", "==", sectionId).get())
    .docs.map((d) => d.id);

  const [attendanceBySection, marksBySection, attendanceByAssignment, marksDocs] = await Promise.all([
    collegeRef.collection("studentAttendance").where("sectionId", "==", sectionId).limit(1).get(),
    collegeRef.collection("internalExamMarks").where("sectionId", "==", sectionId).limit(1).get(),
    // Older sessions/marks may predate the sectionId field but always carry
    // their assignment id - and a marks batch's doc id IS the assignment id.
    getInChunks(assignmentIds, (chunk) => collegeRef.collection("studentAttendance").where("assignmentId", "in", chunk).limit(1)),
    assignmentIds.length > 0
      ? db.getAll(...assignmentIds.map((id) => collegeRef.collection("internalExamMarks").doc(id)))
      : Promise.resolve([]),
  ]);

  return {
    attendanceSessions: !attendanceBySection.empty || attendanceByAssignment.length > 0,
    internalMarks: !marksBySection.empty || marksDocs.some((d) => d.exists),
  };
}

export function sectionHistoryMessage(h: SectionHistory): string | null {
  if (!h.attendanceSessions && !h.internalMarks) return null;
  const what = [h.attendanceSessions && "attendance records", h.internalMarks && "internal marks"].filter(Boolean).join(" and ");
  return `This section has ${what}, which would be orphaned if it were deleted. Keep the section; move its students out or leave it empty instead.`;
}

export interface SectionCascadeResult {
  teachingAssignments: number;
  timetableSlots: number;
  timetableDrafts: number;
  stragglers: number;
}

export async function cascadeDeleteSection(db: Firestore, collegeId: string, sectionId: string): Promise<SectionCascadeResult> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const sectionRef = collegeRef.collection("sections").doc(sectionId);
  const loadChildren = () =>
    Promise.all([
      collegeRef.collection("timetableSlots").where("sectionId", "==", sectionId).get(),
      collegeRef.collection("timetableDrafts").where("sectionId", "==", sectionId).get(),
      collegeRef.collection("teachingAssignments").where("sectionId", "==", sectionId).get(),
    ]);

  const [slots, drafts, assignments] = await loadChildren();
  const children = [...slots.docs, ...drafts.docs, ...assignments.docs].map((d) => d.ref);

  if (children.length < MAX_OPS_PER_BATCH) {
    // Everything fits one batch: all of it or none of it.
    const batch = db.batch();
    for (const ref of children) batch.delete(ref);
    batch.delete(sectionRef);
    await batch.commit();
  } else {
    await deleteInOrder(db, children);
    await sectionRef.delete();
  }

  // Anything created against this section between the read above and its
  // deletion (a slot pinned, an assignment added) would now be an orphan.
  const [slots2, drafts2, assignments2] = await loadChildren();
  const stragglers = [...slots2.docs, ...drafts2.docs, ...assignments2.docs].map((d) => d.ref);
  if (stragglers.length > 0) await deleteInOrder(db, stragglers);

  return {
    teachingAssignments: assignments.size,
    timetableSlots: slots.size,
    timetableDrafts: drafts.size,
    stragglers: stragglers.length,
  };
}
