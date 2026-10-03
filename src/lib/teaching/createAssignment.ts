import type { Firestore } from "firebase-admin/firestore";
import { matchesCurrentSemester } from "@/lib/college/semester";
import { matchesCurrentAcademicYear } from "@/lib/college/academicSession";
import { bumpGuards, facultyGuard, lockGuards, sectionGuard } from "@/lib/timetable/guards";

// Creating a teaching assignment (and the timetable slots staged with it).
//
// The duplicate / "only a lab may have two faculty" / cell-already-taken checks
// used to be queries followed, later, by separate writes - two requests landing
// together both passed and both wrote (two faculty on a theory subject, two
// subjects in one cell). Here the checks and ALL the writes are one
// transaction that first locks the section's guard document (and the faculty
// member's), so concurrent creations in a section run one after another and
// each sees the previous one's result.
//
// It is also all-or-nothing now: a slot that turns out to clash used to leave
// the assignment (and any earlier slots of the same request) behind, answering
// 409 for a half-created thing. Now a 409 means nothing was written.

export interface AssignmentSlotRequest {
  day: string;
  periodNumber: number;
  classroom?: string;
  allowSplit?: boolean;
  labBatch?: string;
}

export interface CreateAssignmentInput {
  db: Firestore;
  collegeId: string;
  /** The final assignment document (already stamped) - written as-is. */
  assignment: Record<string, unknown>;
  facultyId: string;
  facultyName: string;
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  courseId: string;
  year: number;
  department: string;
  timetableSemester: number | null;
  /** Historical record: no conflict checks, no slots. */
  isPast: boolean;
  /** PRACTICAL subjects may have two faculty (Batch 1 / Batch 2); everything else exactly one. */
  isLab: boolean;
  slots: AssignmentSlotRequest[];
  currentAcademicYear: string;
  writer: string;
  now?: Date;
}

export type CreateAssignmentOutcome =
  | { ok: true; id: string; slotIds: string[] }
  | { ok: false; error: string };

type StoredAssignment = { isPast?: boolean; timetableSemester?: number | null };

export async function createAssignmentWithSlots(input: CreateAssignmentInput): Promise<CreateAssignmentOutcome> {
  const { db, collegeId, sectionId, facultyId, subjectId, isPast, timetableSemester } = input;
  const collegeRef = db.collection("colleges").doc(collegeId);
  const assignments = collegeRef.collection("teachingAssignments");
  const slotsCol = collegeRef.collection("timetableSlots");
  const now = input.now ?? new Date();

  const assignmentRef = assignments.doc();
  const slotRefs = input.slots.map(() => slotsCol.doc());
  const staged = !isPast && input.slots.length > 0;
  const guards = [sectionGuard(db, collegeId, sectionId), ...(staged ? [facultyGuard(db, collegeId, facultyId)] : [])];

  return db.runTransaction(async (tx): Promise<CreateAssignmentOutcome> => {
    await lockGuards(tx, guards);

    if (!isPast) {
      // Firestore's "!=" excludes docs missing the field entirely, which every
      // pre-existing current assignment does - so the isPast!==true filter has
      // to happen in application code, not the query, to still catch them.
      const [sameFaculty, sameSubject] = await Promise.all([
        tx.get(assignments.where("facultyId", "==", facultyId).where("sectionId", "==", sectionId).where("subjectId", "==", subjectId)),
        tx.get(assignments.where("sectionId", "==", sectionId).where("subjectId", "==", subjectId)),
      ]);
      const inSemester = (d: { data(): unknown }) => {
        const data = d.data() as StoredAssignment;
        return !data.isPast && matchesCurrentSemester(data.timetableSemester, timetableSemester);
      };
      if (sameFaculty.docs.some(inSemester)) {
        return { ok: false, error: "This faculty is already assigned to this subject for this section" };
      }
      const countInSemester = sameSubject.docs.filter(inSemester).length;
      if (!input.isLab && countInSemester >= 1) {
        return { ok: false, error: "This subject is already assigned for this section — only lab (PRACTICAL) subjects can have 2 faculties (Batch 1/Batch 2)" };
      }
      if (input.isLab && countInSemester >= 2) {
        return { ok: false, error: "Lab subject already has 2 faculties assigned for this section (Batch 1 & Batch 2)" };
      }
    }

    if (staged) {
      // Same-semester / same-session only - a different semester's own slot in
      // this exact day/period isn't a real clash, it's a separate timetable.
      const cellSnaps = await Promise.all(
        input.slots.map((s) =>
          s.allowSplit ? null : tx.get(slotsCol.where("sectionId", "==", sectionId).where("day", "==", s.day).where("periodNumber", "==", s.periodNumber))
        )
      );

      const requested: { day: string; periodNumber: number }[] = [];
      for (let i = 0; i < input.slots.length; i++) {
        const slot = input.slots[i];
        const cell = { day: slot.day, periodNumber: slot.periodNumber };

        const conflict = cellSnaps[i]?.docs.find((d) => {
          const data = d.data() as { semester?: number | null; academicYear?: string };
          return matchesCurrentSemester(data.semester, timetableSemester) && matchesCurrentAcademicYear(data.academicYear, input.currentAcademicYear);
        });
        const repeatsEarlierSlot = !slot.allowSplit && requested.some((r) => r.day === cell.day && r.periodNumber === cell.periodNumber);
        if (conflict || repeatsEarlierSlot) {
          return { ok: false, error: `Conflict: Section ${input.sectionName} already has a subject scheduled on ${slot.day} period ${slot.periodNumber}` };
        }

        // No faculty-clash check across sections: years have their own period
        // timings, so the same faculty may hold the same period number in two
        // sections on purpose.
        requested.push(cell);
      }
    }

    const slotIds: string[] = [];
    tx.set(assignmentRef, input.assignment);
    if (staged) {
      input.slots.forEach((slot, i) => {
        tx.set(slotRefs[i], {
          collegeId,
          department: input.department,
          assignmentId: assignmentRef.id,
          facultyId,
          facultyName: input.facultyName,
          courseId: input.courseId,
          year: input.year,
          sectionId,
          subjectId,
          subjectName: input.subjectName,
          day: slot.day,
          periodNumber: slot.periodNumber,
          classroom: slot.classroom ?? null,
          ...(slot.labBatch ? { labBatch: slot.labBatch } : {}),
          ...(timetableSemester != null ? { semester: timetableSemester } : {}),
          academicYear: input.currentAcademicYear,
          createdAt: now,
          updatedAt: now,
        });
        slotIds.push(slotRefs[i].id);
      });
    }
    bumpGuards(tx, guards, input.writer);
    return { ok: true, id: assignmentRef.id, slotIds };
  });
}
