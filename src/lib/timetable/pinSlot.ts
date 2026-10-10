import type { Firestore } from "firebase-admin/firestore";
import { matchesCurrentSemester } from "@/lib/college/semester";
import { matchesCurrentAcademicYear } from "@/lib/college/academicSession";
import { bumpGuards, facultyGuard, lockGuards, sectionGuard } from "@/lib/timetable/guards";
import type { SlotIdentity } from "@/lib/timetable/liveSlots";

// Pinning one slot straight into a section's published timetable (POST
// /api/college/timetable-slots). The daily-cap and cell-taken checks were
// queries followed by a separate add(), so two pins landing together could
// both pass; and it carried a comment that no faculty-clash check was needed
// because years run their own timings - which is true of period NUMBERS, not of
// clock times. It now applies the one shared overlap rule
// (lib/timetable/facultyOverlap.ts) and does check + write in one transaction
// under the section's and the faculty member's guard documents, which every
// other slot writer (assignment creation, publish) takes too.

export interface PinSlotInput {
  db: Firestore;
  collegeId: string;
  assignmentId: string;
  facultyId: string;
  facultyName: string;
  courseId: string;
  year: number;
  sectionId: string;
  subjectId: string;
  subjectName: string;
  department: string;
  day: string;
  periodNumber: number;
  classroom?: string | null;
  labBatch?: string;
  allowSplit?: boolean;
  semester: number | null;
  currentAcademicYear: string;
  isLiveSlot: (slot: SlotIdentity) => boolean;
  /** Extra fields stamped onto the slot document (e.g. department ids). */
  stamp?: (data: Record<string, unknown>) => Record<string, unknown>;
  writer: string;
  now?: Date;
}

export type PinSlotOutcome = { ok: true; id: string } | { ok: false; error: string };

type StoredSlot = SlotIdentity & { facultyId: string; day: string; periodNumber: number; sectionId: string; subjectId: string };

export async function pinSlotWithChecks(input: PinSlotInput): Promise<PinSlotOutcome> {
  const { db, collegeId, day, sectionId, facultyId } = input;
  const collegeRef = db.collection("colleges").doc(collegeId);
  const slotsCol = collegeRef.collection("timetableSlots");
  const ref = slotsCol.doc();
  const guards = [sectionGuard(db, collegeId, sectionId), facultyGuard(db, collegeId, facultyId)];
  const periodNumber = Number(input.periodNumber);
  const now = input.now ?? new Date();

  return db.runTransaction(async (tx): Promise<PinSlotOutcome> => {
    await lockGuards(tx, guards);

    const [assignmentSnap, facultySnap, cellSnap] = await Promise.all([
      // The caller found the assignment BEFORE this transaction; if it was
      // deleted since (under the same section guard), pinning a slot to it
      // would leave an orphan pointing at nothing.
      tx.get(collegeRef.collection("teachingAssignments").doc(input.assignmentId)),
      tx.get(slotsCol.where("facultyId", "==", facultyId)),
      tx.get(slotsCol.where("sectionId", "==", sectionId).where("day", "==", day).where("periodNumber", "==", periodNumber)),
    ]);

    if (!assignmentSnap.exists) return { ok: false, error: "Teaching assignment not found" };

    const facultyLive = facultySnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as object) }) as StoredSlot & { id: string })
      .filter((s) => input.isLiveSlot(s));

    // Same-semester / same-session occupants of this exact cell.
    const cellSlotsNow = cellSnap.docs
      .map((d) => d.data() as StoredSlot)
      .filter((s) => matchesCurrentSemester(s.semester, input.semester) && matchesCurrentAcademicYear(s.academicYear, input.currentAcademicYear));
    if (!input.allowSplit) {
      if (cellSlotsNow.length > 0) {
        return { ok: false, error: `Conflict: this section already has a subject scheduled on ${day} period ${periodNumber}` };
      }
    } else if (cellSlotsNow.length > 0) {
      // Two labs (parallel batches) may share a period - capped at exactly
      // two. Once a non-teaching subject (Counselling, Mentoring, NSS, ...)
      // is on either side, any NUMBER of subjects may share it instead - a
      // non-teaching session splits freely with anything, uncapped. Two
      // theory classes (or a theory and a lab) with neither side
      // non-teaching still never share a period.
      // Two subjects may share a period, each with any number of faculty - count subjects, not slots.
      const existingSubjectIdSet = new Set(cellSlotsNow.map((s) => s.subjectId));
      const existingSubjectIds = Array.from(existingSubjectIdSet);
      const [incomingSubjectDoc, ...existingSubjectDocs] = await tx.getAll(
        collegeRef.collection("subjects").doc(input.subjectId),
        ...existingSubjectIds.map((id) => collegeRef.collection("subjects").doc(id))
      );
      const incomingType = (incomingSubjectDoc.data() as { type?: string } | undefined)?.type;
      const existingTypes = existingSubjectDocs.map((d) => (d.data() as { type?: string } | undefined)?.type);
      const involvesNonTeaching = incomingType === "NON_TEACHING" || existingTypes.includes("NON_TEACHING");
      if (!involvesNonTeaching) {
        if (existingSubjectIdSet.size >= 2 && !existingSubjectIdSet.has(input.subjectId)) {
          return { ok: false, error: `Period ${periodNumber} on ${day} already has 2 labs sharing it - a period can only be split between two labs.` };
        }
        const allLabs = existingTypes.every((t) => t === "PRACTICAL");
        if (!allLabs || incomingType !== "PRACTICAL") {
          return { ok: false, error: `Period ${periodNumber} on ${day} already has a theory class scheduled - it can't be split with a lab.` };
        }
      }
    }

    // No faculty-clash check across sections: different years run their own
    // period timings, so the same faculty holding the same period number in two
    // sections is allowed on purpose.

    const data: Record<string, unknown> = {
      collegeId,
      department: input.department,
      assignmentId: input.assignmentId,
      facultyId,
      facultyName: input.facultyName,
      courseId: input.courseId,
      year: input.year,
      sectionId,
      subjectId: input.subjectId,
      subjectName: input.subjectName,
      day,
      periodNumber,
      classroom: input.classroom ?? null,
      ...(input.labBatch ? { labBatch: input.labBatch } : {}),
      // This route backs the per-faculty "Weekly Schedule" picker, so anything
      // created here was placed deliberately by a human. Marking it MANUAL/pinned
      // makes the generator schedule around it and stops publish from replacing
      // it (the publish route only clears source === "GENERATED" slots).
      source: "MANUAL",
      isPinned: true,
      semester: input.semester,
      academicYear: input.currentAcademicYear,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(ref, input.stamp ? input.stamp(data) : data);
    bumpGuards(tx, guards, input.writer);
    return { ok: true, id: ref.id };
  });
}
