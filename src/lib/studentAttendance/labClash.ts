import type { Firestore } from "firebase-admin/firestore";
import type { SubjectType, TimetableSlot } from "@/types";
import { activeSlotsOn } from "@/lib/timetable/slotScope";

// Two labs of one section in the same period (Physics lab + Chemistry lab, or one lab shared by two faculty) are
// a batch-wise class: each faculty must mark only their own batch. When the period has no batch (the students were
// never divided, or the timetable period carries no batch), every faculty would get the whole section and the
// period would be counted twice (60 students -> 120). This refuses to open such a period for marking until the
// class in-charge divides the section into lab batches. The same lab shared by several faculty for the whole
// section stays one class: whoever opens it first marks it, a second faculty is refused.

export interface ConcurrentSlot {
  assignmentId: string;
  subjectId: string;
  subjectName: string;
  semester?: number | null;
}

/**
 * The other classes that make marking this period a double count (pure): another assignment's slot in the same
 * section, day and period (same semester when both say), where this class or that one is not a theory class.
 * Empty = no clash. Only consulted when this period has no lab batch.
 */
export function clashingSlots(
  mine: { assignmentId: string; subjectId: string; semester?: number | null },
  others: ConcurrentSlot[],
  typeOf: (subjectId: string) => SubjectType | undefined,
): ConcurrentSlot[] {
  const isLab = (id: string) => {
    const t = typeOf(id);
    return t != null && t !== "THEORY";
  };
  return others.filter((o) =>
    o.assignmentId !== mine.assignmentId
    // The same lab shared by several faculty for the whole section is one class: one of them marks it
    // (a second faculty is stopped by sharedSessionMessage instead).
    && o.subjectId !== mine.subjectId
    && !(mine.semester != null && o.semester != null && mine.semester !== o.semester)
    && (isLab(mine.subjectId) || isLab(o.subjectId)));
}

/** The same subject's whole-section period already opened by another faculty: marking it again would count it twice. */
export function sharedSessionMessage(subjectName: string, sectionName: string, byName: string): string {
  return `${subjectName || "This class"} for ${sectionName} in this period is already being marked by ${byName || "another faculty member"}. One faculty marks a class the whole section attends together; if each faculty should mark their own students, the class in-charge divides the section on Lab Batches.`;
}

export function labClashMessage(sectionName: string, others: ConcurrentSlot[], inchargeName: string | undefined): string {
  const subjects = [...new Set(others.map((o) => o.subjectName).filter(Boolean))].join(", ");
  const who = inchargeName?.trim()
    ? `The class in-charge (${inchargeName.trim()}) divides the students on Lab Batches`
    : "The class in-charge divides the students on Lab Batches (the HOD sets the class in-charge first)";
  return `Divide this section into lab batches before marking this lab. ${subjects || "Another class"} also runs in this period for ${sectionName}, so marking the whole section would count it twice. ${who}; then each lab faculty marks only their own batch.`;
}

/** Live timetable slots of the section in that day + period, checked against this class. Empty = no clash. */
export async function findLabClash(
  db: Firestore,
  collegeId: string,
  slot: Pick<TimetableSlot, "assignmentId" | "subjectId" | "sectionId" | "day" | "periodNumber"> & { semester?: number | null },
  date: string,
  /** A period handed over (class adjustment / leave substitute teaching their own subject): the giver's slot is not
   *  a second class. */
  handedOverBy?: string,
): Promise<ConcurrentSlot[]> {
  const col = db.collection("colleges").doc(collegeId);
  const snap = await col.collection("timetableSlots")
    .where("sectionId", "==", slot.sectionId)
    .where("day", "==", slot.day)
    .get();
  const samePeriod = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as TimetableSlot & { id: string })
    .filter((s) => s.periodNumber === slot.periodNumber && s.assignmentId !== slot.assignmentId && !(handedOverBy && s.facultyId === handedOverBy));
  if (samePeriod.length === 0) return [];
  const live = await activeSlotsOn(db, collegeId, samePeriod, date);
  if (live.length === 0) return [];
  const ids = [...new Set([slot.subjectId, ...live.map((s) => s.subjectId)].filter(Boolean))];
  const subjects = await db.getAll(...ids.map((id) => col.collection("subjects").doc(id)));
  const types = new Map(subjects.map((s) => [s.id, s.get("type") as SubjectType | undefined]));
  return clashingSlots(
    { assignmentId: slot.assignmentId, subjectId: slot.subjectId, semester: slot.semester },
    live.map((s) => ({ assignmentId: s.assignmentId, subjectId: s.subjectId, subjectName: s.subjectName, semester: s.semester })),
    (id) => types.get(id),
  );
}
