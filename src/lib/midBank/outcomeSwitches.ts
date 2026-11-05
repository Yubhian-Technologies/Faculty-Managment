import type { MidOutcomeSwitches } from "@/types/examMidSchedule";

// Which academic tags a college puts on Mid questions: Course Outcomes, the CO-PO/PSO mapping and Bloom's levels.
// Missing = all on (every college before this existed). PO mapping needs COs. A bank / paper set keeps the switches
// it started with, so changing them later never breaks one in progress. Pure - client and server share it.

export const ALL_OUTCOMES_ON: MidOutcomeSwitches = { cos: true, poMapping: true, bloom: true };

export function outcomeSwitches(raw?: Partial<MidOutcomeSwitches> | null): MidOutcomeSwitches {
  const cos = raw?.cos !== false;
  return { cos, poMapping: cos && raw?.poMapping !== false, bloom: raw?.bloom !== false };
}

/** "COs, PO mapping, Bloom's levels" / "none" - for the settings card and notes. */
export function switchesText(s: MidOutcomeSwitches): string {
  const on = [s.cos && "Course Outcomes", s.poMapping && "CO-PO mapping", s.bloom && "Bloom's levels"].filter(Boolean);
  return on.length ? on.join(", ") : "none";
}
