import type { Firestore } from "firebase-admin/firestore";
import { findCurrentSectionDoc } from "@/lib/students/findCurrentSectionDoc";
import { loadEffectiveTiming, resolveCurrentSemester } from "@/lib/college/semester";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
import { matchesCurrentAcademicYear } from "@/lib/college/academicSession";
import type { Course, CourseYearTiming, Section, StudentRecord, TimetableSlot } from "@/types";

export type StudentLookup =
  | { ok: true; student: StudentRecord & { id: string } }
  | { ok: false; reason: "UNLINKED" };

/**
 * The student record linked to a login. `session.uid` is the only input - never
 * an id from the client. Two records claiming the same uid is a data fault, so
 * it fails closed (UNLINKED) rather than quietly picking one.
 */
export async function findOwnStudent(db: Firestore, collegeId: string, uid: string): Promise<StudentLookup> {
  const snap = await db.collection("colleges").doc(collegeId).collection("students").where("uid", "==", uid).limit(2).get();
  if (snap.size !== 1) return { ok: false, reason: "UNLINKED" };
  return { ok: true, student: { ...(snap.docs[0].data() as StudentRecord), id: snap.docs[0].id } };
}

export interface OwnSectionContext {
  student: StudentRecord & { id: string };
  section: (Section & { id: string }) | null;
  course: (Course & { id: string }) | null;
  timing: CourseYearTiming | null;
  currentSemester: number | null;
  academicYear: string;
}

/** Student -> their section -> course + timing + the semester/session that is live now. */
export async function loadOwnSectionContext(
  db: Firestore,
  collegeId: string,
  student: StudentRecord & { id: string }
): Promise<OwnSectionContext> {
  const sectionDoc = await findCurrentSectionDoc(db, collegeId, student);
  const academicYear = await resolveCollegeAcademicYear(db, collegeId);
  if (!sectionDoc) return { student, section: null, course: null, timing: null, currentSemester: null, academicYear };

  const section = { ...(sectionDoc.data() as Section), id: sectionDoc.id };
  const [courseSnap, timing] = await Promise.all([
    db.collection("colleges").doc(collegeId).collection("courses").doc(section.courseId).get(),
    loadEffectiveTiming(db, collegeId, section.courseId, section.year),
  ]);
  const course = courseSnap.exists ? ({ ...(courseSnap.data() as Course), id: courseSnap.id }) : null;
  return { student, section, course, timing, currentSemester: resolveCurrentSemester(timing), academicYear };
}

/** A slot is "live" when it belongs to the current academic session (older cohorts' slots share the same sectionId). */
export function isLiveAcademicYear(slot: Pick<TimetableSlot, "academicYear">, academicYear: string): boolean {
  return matchesCurrentAcademicYear(slot.academicYear, academicYear);
}

/**
 * Lab periods are split by `labBatch`; a student with a batch only sees their
 * own sub-group's sessions (plus every un-split period). A student with no
 * batch assigned yet sees all of them - hiding everything would be worse.
 */
export function slotVisibleToStudent(slot: Pick<TimetableSlot, "labBatch">, studentLabBatch: string | undefined): boolean {
  const mine = studentLabBatch?.trim().toLowerCase();
  if (!slot.labBatch || !mine) return true;
  return slot.labBatch.trim().toLowerCase() === mine;
}
