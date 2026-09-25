import type { Section } from "@/types";

export interface SectionParityGap {
  /** Section names present in the source year but absent from the target year. */
  missing: string[];
  /** Section names present in the target year but not in the source year. */
  extra: string[];
}

const norm = (n: string) => n.trim().toLowerCase();

// Promotion moves a cohort into the same course's next-year sections, so both
// years must carry the same set of section names for the department.
export function sectionParityGap(
  sections: Pick<Section, "department" | "courseId" | "year" | "name">[],
  department: string,
  courseId: string,
  sourceYear: number,
  targetYear: number
): SectionParityGap {
  const names = (year: number) => {
    const m = new Map<string, string>();
    for (const s of sections) {
      if (s.courseId === courseId && s.department === department && s.year === year) m.set(norm(s.name), s.name);
    }
    return m;
  };
  const src = names(sourceYear);
  const tgt = names(targetYear);
  return {
    missing: [...src].filter(([k]) => !tgt.has(k)).map(([, v]) => v).sort(),
    extra: [...tgt].filter(([k]) => !src.has(k)).map(([, v]) => v).sort(),
  };
}

export function describeSectionParityGap(gap: SectionParityGap, sourceYear: number, targetYear: number): string {
  const parts: string[] = [];
  if (gap.missing.length) parts.push(`add Section ${gap.missing.join(", ")} to Year ${targetYear}`);
  if (gap.extra.length) parts.push(`remove Section ${gap.extra.join(", ")} from Year ${targetYear} (or add it to Year ${sourceYear})`);
  return `Year ${sourceYear} and Year ${targetYear} sections don't match - ${parts.join(" and ")} before promoting.`;
}
