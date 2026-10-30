import type { BloomLevel } from "@/types/midQuestionBank";

// Fixed rules of the Mid Question Bank. Which units a Mid covers, the question
// format and marks are the Exam Cell's (MidBankRules); these are not.

export const QUESTIONS_PER_UNIT = 10;
/** Each unit needs every one of these levels at least BLOOM_MIN_PER_UNIT times. */
export const BLOOM_LEVELS: BloomLevel[] = ["L2", "L3", "L4"];
export const BLOOM_MIN_PER_UNIT = 3;

export const BLOOM_LABELS: Record<BloomLevel, string> = {
  L2: "L2 - Understand",
  L3: "L3 - Apply",
  L4: "L4 - Analyse",
};

/** The 11 Programme Outcomes (NBA graduate attributes, current list). */
export const PROGRAM_OUTCOMES: { id: string; title: string }[] = [
  { id: "PO1", title: "Engineering knowledge" },
  { id: "PO2", title: "Problem analysis" },
  { id: "PO3", title: "Design / development of solutions" },
  { id: "PO4", title: "Conduct investigations of complex problems" },
  { id: "PO5", title: "Engineering tool usage" },
  { id: "PO6", title: "The engineer and the world" },
  { id: "PO7", title: "Ethics" },
  { id: "PO8", title: "Individual and collaborative team work" },
  { id: "PO9", title: "Communication" },
  { id: "PO10", title: "Project management and finance" },
  { id: "PO11", title: "Life-long learning" },
];
/** Programme-Specific Outcomes: fixed ids, no statements entered. */
export const PSO_IDS = ["PSO1", "PSO2"];
/** Everything a CO can map to, in display order. */
export const MAPPING_TARGETS = [...PROGRAM_OUTCOMES.map((p) => p.id), ...PSO_IDS];

export const LIMITS = {
  units: 10,
  cos: 10,
  unitTitle: 200,
  unitSyllabus: 3000,
  statement: 500,
  questionText: 3000,
  imageCaption: 150,
  imageBytes: 1024 * 1024,
  imageMaxSide: 2400,
  imageMinSide: 40,
};

export const MID_IMAGE_URL_PREFIX = "https://firebasestorage.googleapis.com/";
