import type { Section, SectionLabBatchSetting, TeachingAssignment, TimetableSlot } from "@/types";
import { getAdminDb } from "@/lib/firebase/admin";
import { fetchSectionStudents } from "@/lib/students/sectionRoster";
import { activeSlotsOn } from "@/lib/timetable/slotScope";
import { istDateKey } from "@/lib/attendance/istTime";
import { LAB_BATCH_SETTINGS, labBatchSettingId, normalizeBatch } from "./labBatchMode";
import { sideBySideLabPeriods, type LabPeriod } from "./labPeriodBatches";

// Server reads behind Students -> Lab Batches (section-lab-batch-settings routes): the section's labs, its batch
// labels, and the periods where two of its labs run side by side.

export interface LabInfo {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  /** The lab's current faculty in this section (one assignment each). */
  faculty: { facultyId: string; facultyName: string }[];
}

/** The distinct lab (PRACTICAL) subjects currently taught in the section, with the faculty teaching each. */
export async function labsOfSection(collegeId: string, sectionId: string): Promise<LabInfo[]> {
  const db = getAdminDb();
  const collegeRef = db.collection("colleges").doc(collegeId);
  const snap = await collegeRef.collection("teachingAssignments").where("sectionId", "==", sectionId).get();
  const current = snap.docs.map((d) => d.data() as TeachingAssignment).filter((a) => !a.isPast && a.subjectId);
  const subjectIds = Array.from(new Set(current.map((a) => a.subjectId)));
  if (subjectIds.length === 0) return [];
  const subjectSnaps = await db.getAll(...subjectIds.map((id) => collegeRef.collection("subjects").doc(id)));
  return subjectSnaps
    .filter((s) => s.exists && (s.data() as { type?: string }).type === "PRACTICAL")
    .map((s) => {
      const d = s.data() as { name?: string; code?: string };
      const seen = new Set<string>();
      const faculty = current
        .filter((a) => a.subjectId === s.id && a.facultyId && !seen.has(a.facultyId) && !!seen.add(a.facultyId))
        .map((a) => ({ facultyId: a.facultyId, facultyName: a.facultyName ?? "" }))
        .sort((x, y) => x.facultyName.localeCompare(y.facultyName));
      return { subjectId: s.id, subjectName: d.name ?? "", subjectCode: d.code ?? "", faculty };
    })
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
}

/** The lab batch labels set up for this section (saved list + whatever students carry), de-duplicated case-insensitively. */
export async function batchesOfSection(collegeId: string, section: Section): Promise<string[]> {
  const db = getAdminDb();
  const students = await fetchSectionStudents(db.collection("colleges").doc(collegeId), {
    department: section.department, sectionName: section.name, year: section.year, courseId: section.courseId,
  });
  const byKey = new Map<string, string>();
  // The batches set up for the section, even ones no student is in yet...
  for (const label of section.labBatches ?? []) {
    const l = label.trim();
    if (l && !byKey.has(normalizeBatch(l))) byKey.set(normalizeBatch(l), l);
  }
  // ...plus any a student already carries.
  for (const s of students) {
    const label = (s.labBatch ?? "").trim();
    if (label && !byKey.has(normalizeBatch(label))) byKey.set(normalizeBatch(label), label);
  }
  return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}


/** The section's live timetable periods where 2+ labs run together, with the batch chosen for each lab, plus the
 *  section's batch labels. */
export async function sectionLabPeriods(collegeId: string, section: Section & { id: string }): Promise<{ periods: LabPeriod[]; batches: string[] }> {
  const db = getAdminDb();
  const col = db.collection("colleges").doc(collegeId);
  const [labs, batches, slotSnap] = await Promise.all([
    labsOfSection(collegeId, section.id),
    batchesOfSection(collegeId, section),
    col.collection("timetableSlots").where("sectionId", "==", section.id).get(),
  ]);
  if (labs.length < 2) return { periods: [], batches };
  const labIds = new Set(labs.map((l) => l.subjectId));
  const slots = slotSnap.docs
    .map((d) => d.data() as TimetableSlot)
    .filter((s) => labIds.has(s.subjectId));
  const live = await activeSlotsOn(db, collegeId, slots, istDateKey(new Date()));
  const settings = await db.getAll(...labs.map((l) => col.collection(LAB_BATCH_SETTINGS).doc(labBatchSettingId(section.id, l.subjectId))));
  const periodsBySubject = new Map(settings.filter((s) => s.exists).map((s) => [(s.data() as SectionLabBatchSetting).subjectId, (s.data() as SectionLabBatchSetting).batchByPeriod]));
  return {
    periods: sideBySideLabPeriods(live, labs.map((l) => ({ ...l, batchByPeriod: periodsBySubject.get(l.subjectId) }))),
    batches,
  };
}
