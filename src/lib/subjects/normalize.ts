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

/** Accepts either the enum key ("PCC") or its full label ("Professional Core"). */
export function resolveSubjectCategory(text: string | undefined): SubjectCategory | undefined {
  if (!text?.trim()) return undefined;
  return CATEGORY_BY_TEXT.get(normalizeText(text));
}

/** Accepts either the enum key ("THEORY") or its full label ("Theory"). */
export function resolveSubjectType(text: string | undefined): SubjectType | undefined {
  if (!text?.trim()) return undefined;
  return TYPE_BY_TEXT.get(normalizeText(text));
}
