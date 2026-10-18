// The heading of a section page: the course, the year, then the section, joined with hyphens -
// "B.Tech-III Year-IT-A".

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

export function shortCourseName(name?: string): string {
  const n = (name ?? "").trim();
  if (!n) return "";
  if (/^(bachelor of technology|b\.?\s?tech)\b/i.test(n)) return "B.Tech";
  if (/^(master of technology|m\.?\s?tech)\b/i.test(n)) return "M.Tech";
  if (/^(bachelor of engineering|b\.?\s?e)\.?$/i.test(n)) return "B.E";
  if (/^(master of business administration|mba)$/i.test(n)) return "MBA";
  if (/^(master of computer applications|mca)$/i.test(n)) return "MCA";
  return n;
}

export function sectionTitle(parts: { courseName?: string; year?: number; sectionName: string }): string {
  const course = shortCourseName(parts.courseName);
  const year = parts.year ? `${ROMAN[parts.year] ?? parts.year} Year` : "";
  const klass = [course, year].filter(Boolean);
  return klass.length > 0 ? [...klass, parts.sectionName].join("-") : `Section ${parts.sectionName}`;
}
