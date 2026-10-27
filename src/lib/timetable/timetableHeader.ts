// The header block and cell text shared by the section timetable's PDF / print
// and Excel downloads, laid out like the college's printed timetable:
//
//   YEAR-SEM-SECTION : II B.Tech-I Sem-CE-A        W.E.F : 20 July 2026
//   BRANCH : Civil Engineering                     ROOM NO : B-304
//   Class I/C: Dr. N A G K Manikanta Kopuri
//
// Kept in one place so the two downloads can't drift apart.

import { SUBJECT_TYPE_LABELS, type SubjectType, type TeachingAssignment, type TimetableSlot } from "@/types";
import { subjectAbbreviation } from "./subjectAbbreviation";
import { toRoman, type AllocationEntry } from "./gridModel";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Bachelor Of Technology" -> "B.Tech"; anything unrecognised is left as written. */
export function shortCourse(course: string): string {
  const c = course.trim();
  if (/^(bachelor of technology|b\.?\s?tech)\b/i.test(c)) return "B.Tech";
  if (/^(master of technology|m\.?\s?tech)\b/i.test(c)) return "M.Tech";
  if (/^(bachelor of engineering|b\.?\s?e)\.?$/i.test(c)) return "B.E";
  if (/^(master of business administration|mba)$/i.test(c)) return "MBA";
  if (/^(master of computer applications|mca)$/i.test(c)) return "MCA";
  return c;
}

/**
 * The section as printed: branch short code + section letter ("CSE-A"). Sections are stored as
 * "A", "CSE-C" or "BSC-CSE-C" - a leading course/group prefix is dropped, and a bare letter or
 * number gets the department's initials in front.
 */
function sectionCode(sectionName?: string, departmentName?: string): string {
  const parts = (sectionName ?? "").trim().split(/[-_\s]+/).filter((w) => w && !/^section$/i.test(w));
  let out = parts.length >= 3 ? parts.slice(1) : parts;
  if (out.length === 1 && !/[A-Za-z]{2,}/.test(out[0]) && departmentName) {
    const initials = departmentName
      .split(/[\s&]+/)
      .filter((w) => /^[A-Za-z]/.test(w) && !/^(and|of|department)$/i.test(w))
      .map((w) => w[0].toUpperCase())
      .join("");
    if (initials) out = [initials, out[0]];
  }
  return out.join("-");
}

export interface TimetableHeaderParts {
  courseName?: string;
  year?: number;
  semesterLabel?: string;
  sectionName?: string;
  departmentName?: string;
  classroom?: string;
  classInchargeName?: string;
  effectiveDate?: string;
}

export interface TimetableHeaderLines {
  /** "YEAR-SEM-SECTION : II B.Tech-I Sem-CSE-A" */
  yearLine: string;
  /** "BRANCH : Civil Engineering" */
  branchLine: string;
  /** "Class I/C: Dr. ..." - empty when the section has no class in-charge. */
  inchargeLine: string;
  /** "W.E.F : 20 July 2026" - empty when no effective date is known. */
  wefLine: string;
  /** "ROOM NO : B-304" - empty when the section has no room. */
  roomLine: string;
}

/** "2026-07-20" -> "20 July 2026"; text that isn't an ISO date is shown as written. */
export function formatWefDate(effectiveDate?: string): string {
  const eff = effectiveDate?.trim();
  if (!eff) return "";
  const iso = eff.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!iso) return eff;
  const month = MONTHS[Number(iso[2]) - 1];
  return month ? `${Number(iso[3])} ${month} ${iso[1]}` : eff;
}

export function buildTimetableHeaderLines(parts: TimetableHeaderParts): TimetableHeaderLines {
  const semNumber = parts.semesterLabel?.match(/\d+/g)?.pop();
  const semester = semNumber ? `${toRoman(Number(semNumber))} Sem` : (parts.semesterLabel ?? "");
  const course = parts.courseName ? shortCourse(parts.courseName) : "";
  const yearCourse = parts.year != null ? `${toRoman(parts.year)} ${course}`.trim() : course;
  const yearText = [yearCourse, semester, sectionCode(parts.sectionName, parts.departmentName)].filter(Boolean).join("-");

  const room = parts.classroom?.trim().replace(/^room\s*(no)?\s*:?\s*/i, "").trim();
  const wef = formatWefDate(parts.effectiveDate);
  const incharge = parts.classInchargeName?.trim();
  return {
    yearLine: yearText ? `YEAR-SEM-SECTION : ${yearText}` : "",
    branchLine: parts.departmentName?.trim() ? `BRANCH : ${parts.departmentName.trim()}` : "",
    inchargeLine: incharge ? `Class I/C: ${incharge}` : "",
    wefLine: wef ? `W.E.F : ${wef}` : "",
    roomLine: room ? `ROOM NO : ${room}` : "",
  };
}

/** "SHRI VISHNU ... WOMEN :: BHIMAVARAM": the college name, with its city beside it when known. */
export function collegeHeading(collegeName?: string, city?: string): string {
  const name = collegeName?.trim() ?? "";
  const place = city?.trim().toUpperCase();
  if (!name) return "";
  return place && !name.toUpperCase().includes(place) ? `${name} :: ${place}` : name;
}

/** "DEPARTMENT OF CIVIL ENGINEERING"; empty without a department. */
export function departmentHeading(departmentName?: string): string {
  const name = departmentName?.trim();
  if (!name) return "";
  return /^department\s+of\b/i.test(name) ? name.toUpperCase() : `DEPARTMENT OF ${name.toUpperCase()}`;
}

/** "Time Table 2026-27", or just "Time Table" when the academic year is unknown. */
export function timetableTitle(academicYear?: string): string {
  const year = academicYear?.trim();
  return year ? `Time Table : ${year}` : "Time Table";
}

const TITLES = /^(dr|mr|mrs|ms|miss|prof|er|sri|smt)$/i;

/**
 * "Dr.Pala Gireesh Kumar" -> "PGK", "Dr.G.Reddy Babu" -> "GRB": the initials printed
 * in brackets under a subject code. A merged cell lists several faculty
 * ("A, B" or "A & B"); each gets its own initials, joined with "/".
 */
export function facultyInitials(name?: string): string {
  if (!name?.trim()) return "";
  return name
    .split(/\s*(?:,|&|\/|\band\b)\s*/i)
    .map((person) =>
      person
        .split(/[\s.]+/)
        .filter((w) => w && !TITLES.test(w) && /^[A-Za-z]/.test(w))
        .map((w) => w[0].toUpperCase())
        .join("")
    )
    .filter(Boolean)
    .join("/");
}

const TYPE_ORDER: SubjectType[] = ["THEORY", "PRACTICAL", "TUTORIAL", "PROJECT", "NON_TEACHING"];

/**
 * The subject list split by kind - Theory, then Practical, then the rest (Non-Teaching / Attendance Only is printed as Co-Curricular) - each with its own
 * numbering. A subject with no recorded type is a Practical when its name says lab / practical,
 * else Theory. Groups with no subjects are left out.
 */
export function groupAllocationByType(allocation: AllocationEntry[]): { label: string; entries: AllocationEntry[] }[] {
  const byType = new Map<SubjectType, AllocationEntry[]>();
  for (const a of allocation) {
    const type = (TYPE_ORDER as string[]).includes(a.subjectType ?? "")
      ? (a.subjectType as SubjectType)
      : /\b(lab|laboratory|practical)\b/i.test(a.name) ? "PRACTICAL" : "THEORY";
    byType.set(type, [...(byType.get(type) ?? []), a]);
  }
  return TYPE_ORDER.filter((t) => byType.has(t)).map((t) => ({ label: t === "NON_TEACHING" ? "Co-Curricular" : SUBJECT_TYPE_LABELS[t], entries: byType.get(t)! }));
}

/**
 * "I Sem" / "II Sem" for a semester label like "3", "2, 4" or "—": the semester's place in its
 * academic year (odd = I, even = II). Empty when the label is empty or mixes odd and even.
 */
export function semesterInYear(semesterLabel?: string): string {
  const nums = (semesterLabel ?? "").match(/\d+/g)?.map(Number) ?? [];
  if (nums.length === 0) return "";
  const odd = nums.filter((n) => n % 2 === 1).length;
  if (odd === nums.length) return "I Sem";
  if (odd === 0) return "II Sem";
  return "";
}

/** "Time Table : 2026-27 I Sem" for a faculty member's own timetable. */
export function facultyTimetableTitle(academicYear?: string, semesterLabel?: string): string {
  const sem = semesterInYear(semesterLabel);
  const year = academicYear?.trim();
  const tail = [year, sem].filter(Boolean).join(" ");
  return tail ? `Time Table : ${tail}` : "Time Table";
}

/** One line of the faculty timetable's bottom list: "IV B.Tech I Sem" (+ " - section" when the class has one). */
export function facultyClassLabel(parts: { courseName?: string; year?: number; semester?: number; sectionName?: string }): string {
  const course = parts.courseName ? shortCourse(parts.courseName) : "";
  const yearCourse = parts.year != null ? `${toRoman(parts.year)} ${course}`.trim() : course;
  const sem = parts.semester != null ? `${parts.semester % 2 === 1 ? "I" : "II"} Sem` : "";
  const base = [yearCourse, sem].filter(Boolean).join(" ");
  return parts.sectionName?.trim() ? `${base} - ${parts.sectionName.trim()}` : base;
}

/**
 * The bottom list of a faculty timetable - one row per class + subject the grid shows:
 * "IV B.Tech I Sem - CSE-A" | acronym | subject name. Scoped to the assignments the given slots use.
 */
export function buildFacultyClassRows(
  slots: Pick<TimetableSlot, "assignmentId" | "semester">[],
  assignments: Iterable<TeachingAssignment>
): { cls: string; acr: string; name: string }[] {
  const inGrid = new Set(slots.map((s) => s.assignmentId));
  const rows = new Map<string, { cls: string; acr: string; name: string }>();
  for (const a of assignments) {
    if (!inGrid.has(a.id)) continue;
    const semester = slots.find((sl) => sl.assignmentId === a.id)?.semester ?? a.semester;
    const cls = facultyClassLabel({ courseName: a.courseName, year: a.year, semester, sectionName: a.sectionName });
    const acr = subjectAbbreviation(a.subjectName, a.shortCode) || "—";
    const name = a.subjectName ?? "—";
    rows.set(`${cls}|${acr}|${name}`, { cls, acr, name });
  }
  return Array.from(rows.values());
}
