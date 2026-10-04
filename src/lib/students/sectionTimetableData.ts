import type { Firestore } from "firebase-admin/firestore";
import { DEFAULT_TIMETABLE_RULES } from "@/types";
import type { Course, CourseYearTiming, Department, Section, Subject, TimetableSlot, TeachingAssignment, TimetableRules } from "@/types";

// Everything a student's timetable view reads that depends on the SECTION, not on the student:
// course, year timing, the section's slots and teaching assignments, departments, timetable rules and
// the course's subjects. Every student of a section asks for the same data, so a section of 60
// students opening the page at once used to cost 60x the reads. This keeps one copy per section for
// a short window and shares an in-flight load between concurrent callers. A published timetable
// change therefore reaches students within SECTION_TIMETABLE_TTL_MS.

export const SECTION_TIMETABLE_TTL_MS = 60_000;

export interface SectionTimetableData {
  course: Course | null;
  timing: CourseYearTiming | null;
  departments: Department[];
  timetableRules: TimetableRules;
  slots: (TimetableSlot & { id: string })[];
  assignments: (TeachingAssignment & { id: string })[];
  subjects: Subject[];
}

const cache = new Map<string, { at: number; value: Promise<SectionTimetableData> }>();

async function load(db: Firestore, collegeId: string, section: Section & { id: string }): Promise<SectionTimetableData> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const [courseSnap, timingsSnap, slotsSnap, assignmentsSnap, deptsSnap, rulesSnap, subjectsSnap] = await Promise.all([
    collegeRef.collection("courses").doc(section.courseId).get(),
    collegeRef.collection("courseYearTimings").where("courseId", "==", section.courseId).where("year", "==", section.year).limit(1).get(),
    collegeRef.collection("timetableSlots").where("sectionId", "==", section.id).get(),
    collegeRef.collection("teachingAssignments").where("sectionId", "==", section.id).get(),
    collegeRef.collection("departments").get(),
    collegeRef.collection("settings").doc("timetableRules").get(),
    collegeRef.collection("subjects").where("courseId", "==", section.courseId).get(),
  ]);
  return {
    course: courseSnap.exists ? ({ id: courseSnap.id, ...courseSnap.data() } as Course) : null,
    timing: timingsSnap.empty ? null : ({ id: timingsSnap.docs[0].id, ...timingsSnap.docs[0].data() } as CourseYearTiming),
    departments: deptsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Department),
    timetableRules: rulesSnap.exists ? { ...DEFAULT_TIMETABLE_RULES, ...(rulesSnap.data() as Partial<TimetableRules>) } : DEFAULT_TIMETABLE_RULES,
    slots: slotsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as TimetableSlot & { id: string }),
    assignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as TeachingAssignment & { id: string }),
    subjects: subjectsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Subject),
  };
}

export function getSectionTimetableData(db: Firestore, collegeId: string, section: Section & { id: string }): Promise<SectionTimetableData> {
  const key = `${collegeId}/${section.id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < SECTION_TIMETABLE_TTL_MS) return hit.value;
  const value = load(db, collegeId, section);
  cache.set(key, { at: Date.now(), value });
  // A failed load must not be served for the whole window.
  value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
  return value;
}

export function clearSectionTimetableCache(): void {
  cache.clear();
}
