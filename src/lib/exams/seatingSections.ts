import type { Section } from "@/types";

const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

export function sectionLabel(s: Pick<Section, "department" | "year" | "name">): string {
  return `${s.department} · ${ordinal(s.year)} Year · ${s.name}`;
}
