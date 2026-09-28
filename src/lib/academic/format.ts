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
