import type { Firestore } from "firebase-admin/firestore";
import { loadCollegeSettings } from "@/lib/firestore/collegeSettings";
import { resolveAcademicYearStart, resolveTimetableAcademicYear } from "./academicSession";

/**
 * The college's current academic year, short form ("2026-27") - the one shape
 * every consumer stamps records with and compares against.
 *
 * Worked out from today against the college's own start day (Settings ▸
 * Academic Year), so it advances by itself: a June-1 college is in 2026-27 up
 * to 31 May 2027 and in 2027-28 the next morning. Nothing is stored and
 * nothing has to be rolled over by hand - which matters because this app has
 * no scheduler to do it.
 *
 * A pinned academicSessions doc still wins if one exists. That is purely for
 * the colleges that set one before the start day became configurable; the
 * Settings screen no longer creates them, and clearing the pin is what lets a
 * college start advancing on its own.
 *
 * Replaces an identical three-line idiom that was copy-pasted at seven call
 * sites, each of which resolved the fallback with the April cutoff hardcoded.
 */
export async function resolveCollegeAcademicYear(
  db: Firestore,
  collegeId: string,
  now: Date = new Date()
): Promise<string> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const [sessionSnap, settings] = await Promise.all([
    collegeRef.collection("academicSessions").where("isCurrent", "==", true).limit(1).get(),
    loadCollegeSettings(db, collegeId),
  ]);
  const pinnedLabel = sessionSnap.empty
    ? undefined
    : (sessionSnap.docs[0].data() as { label?: string }).label;
  return resolveTimetableAcademicYear(pinnedLabel, now, resolveAcademicYearStart(settings));
}
