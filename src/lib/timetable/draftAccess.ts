import { FieldValue } from "firebase-admin/firestore";
import { draftDocId, matchesCurrentSemester } from "@/lib/college/semester";
import type { TimetableContext } from "@/lib/timetable/loadContext";
import type { DraftSlot, TimetableDraft, TimetableSlot } from "@/types";

// Shared department-scope/lending checks and draft-document access, used by
// every route that reads or writes a section's TimetableDraft - the hand-edit
// draft route (api/college/timetable/draft) and the timetable-import routes
// (api/college/timetable/import, .../import/confirm) all need the exact same
// "who may touch this section's draft" rules.

// A lending HOD or Timetable Incharge (see api/college/faculty-assignment-requests)
// doesn't own this section's department, but legitimately needs to place/move/remove
// periods for the one TeachingAssignment they were allocated - the section's
// own HOD publishes, they only "Notify" (see the timetable grid page).
// Scoped to ALLOCATED requests only (never PENDING/DECLINED), and - when
// `assignmentId` is given - to that exact assignment, so a lender can
// never touch another department's other subjects via this exception.
export async function findAllocatedRequestsForSection(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  sectionId: string,
): Promise<{ targetDepartmentName?: string; teachingAssignmentId?: string }[]> {
  const snap = await db.collection("colleges").doc(collegeId).collection("facultyAssignmentRequests")
    .where("sectionId", "==", sectionId)
    .where("status", "==", "ALLOCATED")
    .get();
  return snap.docs.map((d) => d.data() as { targetDepartmentName?: string; teachingAssignmentId?: string });
}

// `myNames` is either an HOD's own department scope (ownDepartmentNames) or
// - for a Timetable Incharge fulfilling on behalf of their department - just
// the single department name they're Incharge for. Either way this only
// grants access to a section that ISN'T theirs when their own department was
// the one allocated to lend a faculty member for it.
export async function isCrossDepartmentLender(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  myNames: string[],
  sectionId: string,
  assignmentId?: string,
): Promise<boolean> {
  if (myNames.length === 0) return false;
  const allocated = await findAllocatedRequestsForSection(db, collegeId, sectionId);
  return allocated.some(
    (r) => myNames.includes(r.targetDepartmentName ?? "") && (!assignmentId || r.teachingAssignmentId === assignmentId),
  );
}

// A Timetable Incharge (PANEL_MEMBER/COLLEGE_STAFF) always has exactly one
// home department (the assignment POST validates the person's own
// department matches the delegated course's), unlike an HOD's own
// scope/ownDepartmentNames which can span more than one - so this is just
// their login's own `department` field, wrapped as a one-item list for
// isCrossDepartmentLender's shared shape.
export async function inchargeOwnDepartmentNames(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  uid: string,
): Promise<string[]> {
  const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
  const department = (snap.data() as { department?: string } | undefined)?.department;
  return department ? [department] : [];
}

export async function loadDraft(
  db: FirebaseFirestore.Firestore, collegeId: string, sectionId: string, semester: number | null,
): Promise<TimetableDraft | null> {
  const snap = await db
    .collection("colleges").doc(collegeId)
    .collection("timetableDrafts").doc(draftDocId(sectionId, semester))
    .get();
  return snap.exists ? ({ id: snap.id, ...snap.data() } as TimetableDraft) : null;
}

/** Distinct faculty on a slot list - the value of TimetableDraft.facultyIds. */
export function draftFacultyIds(slots: Pick<DraftSlot, "facultyId">[]): string[] {
  return Array.from(new Set(slots.map((s) => s.facultyId).filter(Boolean)));
}

export function draftRef(
  db: FirebaseFirestore.Firestore, collegeId: string, sectionId: string, semester: number | null,
): FirebaseFirestore.DocumentReference {
  return db.collection("colleges").doc(collegeId)
    .collection("timetableDrafts").doc(draftDocId(sectionId, semester));
}

/**
 * Builds a fresh draft for a section that has none yet, seeded from its
 * currently PUBLISHED (GENERATED-source) slots so starting to edit never
 * silently drops a live timetable from view - shared by the hand-edit
 * draft route's POST (starting a blank/seeded draft to build manually) and
 * timetable import's confirm route (which needs a draft to append into
 * exactly as readily as the manual flow does). Does not write anything.
 */
export async function buildSeededDraft(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  sectionId: string,
  ctx: TimetableContext,
  generatedByName: string,
): Promise<Omit<TimetableDraft, "id">> {
  const publishedSnap = await db.collection("colleges").doc(collegeId).collection("timetableSlots")
    .where("sectionId", "==", sectionId).where("source", "==", "GENERATED").get();
  // Only this section's CURRENT semester's own published slots (plus any
  // legacy ones with no semester tag at all) seed the new draft - a prior
  // semester's published GENERATED slots stay as history, not something
  // building "now" should silently resurrect.
  const published = publishedSnap.docs
    .map((d) => d.data() as TimetableSlot)
    .filter((s) => matchesCurrentSemester(s.semester, ctx.currentSemester));

  // A block's 2nd..Nth period is the only thing that needs recomputing -
  // everything else on TimetableSlot maps straight onto DraftSlot.
  const continuationKeys = new Set<string>();
  const byAssignmentDay = new Map<string, Set<number>>();
  for (const s of published) {
    const key = `${s.assignmentId}|${s.day}`;
    const periods = byAssignmentDay.get(key) ?? new Set<number>();
    periods.add(s.periodNumber);
    byAssignmentDay.set(key, periods);
  }
  for (const s of published) {
    const periods = byAssignmentDay.get(`${s.assignmentId}|${s.day}`)!;
    if (periods.has(s.periodNumber - 1)) continuationKeys.add(`${s.assignmentId}|${s.day}|${s.periodNumber}`);
  }

  const seededSlots: DraftSlot[] = published.map((s) => ({
    assignmentId: s.assignmentId,
    facultyId: s.facultyId,
    facultyName: s.facultyName,
    subjectId: s.subjectId,
    subjectName: s.subjectName,
    subjectType: ctx.subjectsById.get(s.subjectId)?.type ?? "THEORY",
    day: s.day,
    periodNumber: s.periodNumber,
    isBlockContinuation: continuationKeys.has(`${s.assignmentId}|${s.day}|${s.periodNumber}`),
  }));

  return {
    collegeId,
    department: ctx.section.department,
    courseId: ctx.section.courseId,
    year: Number(ctx.section.year),
    sectionId,
    sectionName: ctx.section.name,
    semester: ctx.currentSemester,
    status: "DRAFT" as const,
    slots: seededSlots,
    facultyIds: draftFacultyIds(seededSlots),
    diagnostics: seededSlots.length > 0
      ? ["Started from the currently published timetable - edit and republish when ready."]
      : ["Started as a blank timetable - add subjects by clicking a period."],
    generatedAt: FieldValue.serverTimestamp() as unknown as TimetableDraft["generatedAt"],
    generatedByName,
  };
}
