import type { Firestore } from "firebase-admin/firestore";
import type { TeachingAssignment, TimetableSlot } from "@/types";
import { resolveSubstituteSlotsForDate } from "@/lib/leave/periodCoverage";
import { pickOwnAssignment, virtualSlotFor, type AdjustableSlot } from "@/lib/classAdjustments/rules";

// How a leave substitute takes each period they cover on a date:
//  - OWN SUBJECT: the substitute holds a current teaching assignment on that section -> they teach their own subject
//    (a virtual slot under their assignment, like "Adjust / Swap a Class"; class work + attendance go to their subject).
//    Teaching two subjects there: the theory one first, then by name.
//  - ATTENDANCE ONLY: they don't teach that section (another department, no subject) -> they mark attendance under
//    the absent faculty's subject, as before, with no Record of the Class Work needed (the session is flagged).

export interface SubstituteDay {
  ownSubject: AdjustableSlot[];
  attendanceOnly: (TimetableSlot & { id: string })[];
}

const EMPTY: SubstituteDay = { ownSubject: [], attendanceOnly: [] };

export { pickOwnAssignment };

export async function substituteDay(db: Firestore, collegeId: string, substituteFacultyId: string, dateISO: string, opts: { fresh?: boolean } = {}): Promise<SubstituteDay> {
  const covering = await resolveSubstituteSlotsForDate(db, collegeId, substituteFacultyId, dateISO, opts);
  if (covering.size === 0) return EMPTY;
  const collegeRef = db.collection("colleges").doc(collegeId);
  const [slotSnaps, mineSnap] = await Promise.all([
    db.getAll(...[...covering.keys()].map((id) => collegeRef.collection("timetableSlots").doc(id))),
    collegeRef.collection("teachingAssignments").where("facultyId", "==", substituteFacultyId).get(),
  ]);
  const bySection = new Map<string, (TeachingAssignment & { id: string })[]>();
  for (const d of mineSnap.docs) {
    const a = { ...(d.data() as TeachingAssignment), id: d.id };
    if (a.isPast || !a.sectionId) continue;
    bySection.set(a.sectionId, [...(bySection.get(a.sectionId) ?? []), a]);
  }
  const out: SubstituteDay = { ownSubject: [], attendanceOnly: [] };
  for (const snap of slotSnaps) {
    if (!snap.exists) continue;
    const slot = { id: snap.id, ...snap.data() } as TimetableSlot & { id: string };
    const original = covering.get(snap.id)!;
    const own = pickOwnAssignment(bySection.get(slot.sectionId) ?? []);
    if (!own) { out.attendanceOnly.push(slot); continue; }
    out.ownSubject.push({
      ...virtualSlotFor({
        adjustmentId: "LEAVE", slotId: slot.id, day: slot.day, periodNumber: slot.periodNumber,
        department: slot.department, courseId: slot.courseId, year: slot.year, semester: slot.semester ?? undefined,
        sectionId: slot.sectionId, sectionName: own.sectionName ?? "", classroom: slot.classroom,
        fromFacultyId: original.originalFacultyId, fromFacultyName: original.originalFacultyName,
        fromAssignmentId: slot.assignmentId, fromSubjectId: slot.subjectId, fromSubjectName: slot.subjectName,
        toFacultyId: substituteFacultyId, toFacultyName: own.facultyName ?? "", toAssignmentId: own.id,
        toSubjectId: own.subjectId, toSubjectName: own.subjectName,
      }, collegeId),
      // Keep the mid-scope of the original slot (activeSlotsOn).
      ...(slot.midScope != null ? { midScope: slot.midScope } : {}),
    } as AdjustableSlot);
  }
  return out;
}
