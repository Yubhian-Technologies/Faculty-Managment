/**
 * Academic formatting helpers for Roman numeral notation and short course codes.
 * e.g., "I B.Tech - I Sem", "II B.Tech - I Sem - Sec A", "I Sem", "IV Year".
 */

export function toRoman(n: number | string | undefined | null): string {
  if (n == null || n === "") return "";
  const num = typeof n === "string" ? parseInt(n, 10) : n;
  if (isNaN(num) || num <= 0) return String(n);
  const romanMap: Record<number, string> = {
    1: "I",
    2: "II",
    3: "III",
    4: "IV",
    5: "V",
    6: "VI",
    7: "VII",
    8: "VIII",
    9: "IX",
    10: "X",
  };
  return romanMap[num] || String(num);
}

export function formatShortCourseName(courseName?: string | null, courseCode?: string | null): string {
  if (courseCode && courseCode.trim()) {
    const clean = courseCode.trim().toUpperCase();
    if (clean === "BTECH" || clean === "B.TECH") return "B.Tech";
    if (clean === "MTECH" || clean === "M.TECH") return "M.Tech";
    if (clean === "MBA") return "MBA";
    if (clean === "MCA") return "MCA";
    if (clean === "BPHARM" || clean === "B.PHARM") return "B.Pharm";
    if (clean === "PHARMD" || clean === "PHARM.D") return "Pharm.D";
    return courseCode.trim();
  }
  if (!courseName) return "";
  const name = courseName.trim();
  const lower = name.toLowerCase();
  if (lower.includes("bachelor of technology") || lower === "b.tech" || lower === "btech") return "B.Tech";
  if (lower.includes("master of technology") || lower === "m.tech" || lower === "mtech") return "M.Tech";
  if (lower.includes("bachelor of pharmacy") || lower === "b.pharm" || lower === "bpharm") return "B.Pharm";
  if (lower.includes("doctor of pharmacy") || lower === "pharm.d" || lower === "pharmd") return "Pharm.D";
  if (lower.includes("master of business administration") || lower === "mba") return "MBA";
  if (lower.includes("master of computer applications") || lower === "mca") return "MCA";
  return name;
}

export function formatAcademicShortNotation({
  year,
  courseName,
  courseCode,
  semester,
  sectionName,
}: {
  year?: number | null;
  courseName?: string | null;
  courseCode?: string | null;
  semester?: number | null;
  sectionName?: string | null;
}): string {
  const parts: string[] = [];
  const romanYear = year ? toRoman(year) : "";
  const shortCourse = formatShortCourseName(courseName, courseCode);

  if (romanYear && shortCourse) {
    parts.push(`${romanYear} ${shortCourse}`);
  } else if (romanYear) {
    parts.push(`${romanYear} Year`);
  } else if (shortCourse) {
    parts.push(shortCourse);
  }

  if (semester) {
    parts.push(`${toRoman(semester)} Sem`);
  }

  if (sectionName) {
    parts.push(`Sec ${sectionName}`);
  }

  return parts.join(" - ");
}

/**
 * A semester number written the way the college actually says it: "2-1" for
 * the first semester of second year, rather than the flat "Semester 3" the
 * number itself is stored as.
 *
 * Semester numbers are stored running across the whole course (1..8 for a
 * four-year B.Tech), but nobody refers to them that way - a student is in
 * "3-2", not "Semester 6". Every semester picker in the app was rendering the
 * raw number.
 *
 * `semestersPerYear` is how many a year is split into. It defaults to 2
 * because that is what every caller assumes today; pass the real figure where
 * a course-year's own configuration (CourseYearTiming.semesters) is to hand,
 * so a college running three terms a year reads correctly.
 *
 * Returns "" for a non-positive or non-finite semester rather than inventing
 * a year, so a caller can fall back to its own placeholder.
 */
export function yearSemesterLabel(semester: number, semestersPerYear = 2): string {
  if (!Number.isFinite(semester) || semester < 1) return "";
  const perYear = Number.isFinite(semestersPerYear) && semestersPerYear >= 1 ? Math.floor(semestersPerYear) : 2;
  const year = Math.ceil(semester / perYear);
  const withinYear = semester - (year - 1) * perYear;
  return `${year}-${withinYear}`;
}

/**
 * A semester's label from the YEAR it belongs to and its position within that
 * year: "2-1" for the first semester of second year.
 *
 * Prefer this over yearSemesterLabel wherever the course-year's own semester
 * list is to hand, because the stored NUMBER cannot be trusted to mean the
 * same thing twice. Across the live colleges both conventions are in use:
 *
 *   year 2 -> semesters [1,2]   (numbered within the year)   - 12 course-years
 *   year 3 -> semesters [5,6]   (numbered across the course) -  2 course-years
 *
 * Dividing the number by a semesters-per-year figure is right for the second
 * and wrong for the first - it labelled second year's semesters "1-1" and
 * "1-2". Position is correct for both: [1,2] in year 2 and [3,4] in year 2
 * both read 2-1 and 2-2.
 *
 * Falls back to yearSemesterLabel when `semester` is not in the list at all,
 * so a stale pick still renders something rather than an empty label.
 */
export function yearSemesterLabelIn(year: number, semestersInYear: number[], semester: number): string {
  if (!Number.isFinite(year) || year < 1) return yearSemesterLabel(semester);
  const sorted = [...new Set(semestersInYear.filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);
  const index = sorted.indexOf(semester);
  if (index < 0) return yearSemesterLabel(semester);
  return `${year}-${index + 1}`;
}
