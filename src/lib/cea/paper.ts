import type { CeaSettings, MidPaperPattern, PaperPartDef } from "@/types";

// The with-Mid CEA paper as a part of the setter's paper set - pure. The setter builds it (questions and marks
// each) to the unit's marks. It is written, reviewed, approved, chosen
// and finalized with the Mid paper, but printed as its OWN paper (own header, its minutes, the unit's marks)
// and never counted in the Mid's marks. The Mid's time = the pattern's minus the CEA minutes.

export const CEA_PART_ID = "CEA";

/**
 * The CEA paper part: the Exam Cell fixes only its max marks (the unit's marks); the setter writes as many
 * questions as they like, each with its own whole marks, adding up to that max (a faculty-decides part). Every
 * question is on the planned unit.
 */
export function ceaPart(settings: Pick<CeaSettings, "unitMarks" | "paperMinutes">, unit: number): PaperPartDef {
  return {
    id: CEA_PART_ID, label: `CIE - Unit ${unit}`, title: `Continuous Internal Evaluation - Unit ${unit}`,
    flexible: true, maxMarks: settings.unitMarks, kind: "DESCRIPTIVE", questions: 0, marksEach: 0, choice: { kind: "ALL" },
    cea: { unit, minutes: settings.paperMinutes },
  };
}

export const isCeaPart = (p: Pick<PaperPartDef, "cea">) => !!p.cea;
export const ceaPartOf = <P extends Pick<PaperPartDef, "cea">>(parts: P[]): P | undefined => parts.find(isCeaPart);
export const midPartsOf = <P extends Pick<PaperPartDef, "cea">>(parts: P[]): P[] => parts.filter((p) => !isCeaPart(p));

/** The pattern with this Mid's CEA part (or none): any old CEA part is replaced; it always comes last. */
export function withCeaPart<P extends Pick<MidPaperPattern, "parts">>(pattern: P, part: PaperPartDef | null): P {
  return { ...pattern, parts: [...midPartsOf(pattern.parts), ...(part ? [part] : [])] };
}

/** The pattern without its CEA part (the Mid paper itself - for its marks and its own print). */
export const withoutCea = <P extends Pick<MidPaperPattern, "parts">>(pattern: P): P => ({ ...pattern, parts: midPartsOf(pattern.parts) });

/** The Mid paper's own time: the sitting minus the CEA paper's minutes. */
export const midMinutes = (pattern: Pick<MidPaperPattern, "parts" | "durationMinutes">) =>
  Math.max(1, pattern.durationMinutes - (ceaPartOf(pattern.parts)?.cea?.minutes ?? 0));
