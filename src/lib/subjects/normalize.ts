// Shared "type either the enum key or its full label" matching for Subject
// Category/Type, used by the bulk importer (server) and, client-side, by the
// import review UI's "fix this failed row" dialog - one implementation
// instead of two near-identical copies, same rationale as
// src/lib/departments/codeOrNameResolver.ts. Pure functions over the shared
// label maps, so a server route and a client page can call the exact same
// code.
import type { SubjectCategory, SubjectType } from "@/types";
import { SUBJECT_CATEGORY_LABELS, SUBJECT_TYPE_LABELS } from "@/types";

function normalizeText(v: string): string {
  return v.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const CATEGORY_BY_TEXT = new Map<string, SubjectCategory>();
for (const [key, label] of Object.entries(SUBJECT_CATEGORY_LABELS) as [SubjectCategory, string][]) {
  CATEGORY_BY_TEXT.set(normalizeText(key), key);
  CATEGORY_BY_TEXT.set(normalizeText(label), key);
}

const TYPE_BY_TEXT = new Map<string, SubjectType>();
for (const [key, label] of Object.entries(SUBJECT_TYPE_LABELS) as [SubjectType, string][]) {
  TYPE_BY_TEXT.set(normalizeText(key), key);
  TYPE_BY_TEXT.set(normalizeText(label), key);
}

// Common aliases in Indian college curricula (AICTE, JNTU, Anna Univ, VTU, etc.)
const TYPE_ALIASES: Record<string, SubjectType> = {
  // Practical / Lab
  lab: "PRACTICAL",
  laboratory: "PRACTICAL",
  practical: "PRACTICAL",
  practicals: "PRACTICAL",
  "lab course": "PRACTICAL",
  "laboratory course": "PRACTICAL",
  "practical course": "PRACTICAL",
  "practical lab": "PRACTICAL",
  "lab practical": "PRACTICAL",
  p: "PRACTICAL",

  // Theory
  theory: "THEORY",
  theories: "THEORY",
  lecture: "THEORY",
  lectures: "THEORY",
  th: "THEORY",
  lec: "THEORY",
  "theory course": "THEORY",

  // Tutorial
  tutorial: "TUTORIAL",
  tutorials: "TUTORIAL",
  tut: "TUTORIAL",
  tu: "TUTORIAL",

  // Project
  project: "PROJECT",
  projects: "PROJECT",
  "project work": "PROJECT",
  "mini project": "PROJECT",
  "major project": "PROJECT",
  internship: "PROJECT",
  seminar: "PROJECT",
  viva: "PROJECT",
  "comprehensive viva": "PROJECT",

  // Non-Teaching / Attendance Only
  "non teaching": "NON_TEACHING",
  "non-teaching": "NON_TEACHING",
  "non teaching load": "NON_TEACHING",
  "attendance only": "NON_TEACHING",
  sports: "NON_TEACHING",
  library: "NON_TEACHING",
  nss: "NON_TEACHING",
};

for (const [alias, type] of Object.entries(TYPE_ALIASES)) {
  TYPE_BY_TEXT.set(normalizeText(alias), type);
}

/** Accepts either the enum key ("PCC"), its full label ("Professional Core"), or any custom category name. */
export function resolveSubjectCategory(text: string | undefined): SubjectCategory | undefined {
  if (!text?.trim()) return undefined;
  const matched = CATEGORY_BY_TEXT.get(normalizeText(text));
  if (matched) return matched;
  return text.trim() as SubjectCategory;
}

/** Accepts either the enum key ("THEORY"), its full label ("Theory"), or common aliases like "Lab", "Practical", etc. */
export function resolveSubjectType(text: string | undefined): SubjectType | undefined {
  if (!text?.trim()) return undefined;
  const normalized = normalizeText(text);
  const matched = TYPE_BY_TEXT.get(normalized);
  if (matched) return matched;

  // Keyword-based fallback matching for compound or descriptive strings
  if (normalized.includes("non teaching") || normalized.includes("attendance only")) {
    return "NON_TEACHING";
  }
  if (normalized.includes("lab") || normalized.includes("practical")) {
    return "PRACTICAL";
  }
  if (normalized.includes("theory") || normalized.includes("lecture")) {
    return "THEORY";
  }
  if (normalized.includes("tutorial")) {
    return "TUTORIAL";
  }
  if (normalized.includes("project") || normalized.includes("internship") || normalized.includes("seminar")) {
    return "PROJECT";
  }

  return undefined;
}

