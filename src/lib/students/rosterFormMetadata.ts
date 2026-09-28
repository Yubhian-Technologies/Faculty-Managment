import type { AcademicYear, Course, Department } from "@/types";

export interface RosterFormMetadata {
  departments: Department[];
  /** Distinct programme names, e.g. every department's own "Bachelor of Technology" collapsed to one entry. */
  courseNames: string[];
  courses: Course[];
  /** The college's configured academic years, capped at the longest real course duration, falling back to 1-4. */
  years: number[];
}

/**
 * The Course/Department/Academic Year picker data the Add/Edit Student form
 * (RosterFormFields) needs, fetched fresh - shared by every caller of
 * StudentFormDialog (the Students list page's own filter bar loads this data
 * too, but separately, since it needs it whether or not the dialog is even
 * open) so the same three requests and the same "distinct programme names,
 * years capped by course duration" shaping isn't duplicated per caller.
 */
export async function fetchRosterFormMetadata(): Promise<RosterFormMetadata> {
  const [deptsRes, yearsRes, coursesRes] = await Promise.all([
    fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
    fetch("/api/college/academic-years").then((r) => r.json() as Promise<{ academicYears?: AcademicYear[] }>).catch(() => ({ academicYears: [] })),
    fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>).catch(() => ({ courses: [] })),
  ]);
  const departments = deptsRes.departments ?? [];
  const courses = coursesRes.courses ?? [];
  // Every department owns its own Course doc for the same programme, so the
  // raw list repeats "Bachelor of Technology" once per department - the
  // picker wants the distinct programme names.
  const courseNames = Array.from(
    new Set(courses.map((c) => c.name?.trim()).filter(Boolean) as string[])
  ).sort((a, b) => a.localeCompare(b));
  // Prefer the college's configured academic years; a sensible 1-4 default so
  // the dropdowns are never empty for a freshly set-up college. The
  // college-wide Academic Years list (Principal-managed) has no idea which
  // years any real course actually reaches, so it's capped at the longest
  // real course duration - the same cap the Principal's own Years Taught
  // editor already enforces.
  const configured = (yearsRes.academicYears ?? []).map((y) => y.yearNumber).filter(Boolean);
  const maxCourseDuration = courses.reduce((max, c) => Math.max(max, Number(c.durationYears) || 0), 0);
  const capped = maxCourseDuration > 0 ? configured.filter((y) => y <= maxCourseDuration) : configured;
  const years = capped.length > 0 ? capped : [1, 2, 3, 4];
  return { departments, courseNames, courses, years };
}
