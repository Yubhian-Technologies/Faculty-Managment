import type { Section } from "@/types";

// Class Representatives (CR-1 / CR-2) of a section: how many it has, and which students hold the seats.

export const MAX_CLASS_REPRESENTATIVES = 2;

type CrSection = Pick<Section, "classRepresentativeCount" | "classRepresentatives">;

/** How many CRs the section has: what the HOD set (0-2), else the full two. */
export function classRepresentativeCountOf(section: CrSection): number {
  const n = section.classRepresentativeCount;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_CLASS_REPRESENTATIVES ? n : MAX_CLASS_REPRESENTATIVES;
}

/** A pick list the API will accept: distinct student ids, at most `count` of them. Returns an error message or null. */
export function validateRepresentativePicks(ids: unknown, count: number): string | null {
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string" || !x)) return "studentIds must be a list of student ids";
  if (new Set(ids).size !== ids.length) return "The same student can't be picked twice";
  if (ids.length > count) return count === 0 ? "This section has no Class Representatives set up" : `This section has ${count} Class Representative${count === 1 ? "" : "s"}`;
  return null;
}
