// Minimum qualification enforcement for FacultyNorms.minimumQualifications
// (assistantProfessor / associateProfessor / professor) — NOT PositionNorms.

import { classifyHighestQualification, HIGHEST_QUALIFICATION_OPTIONS } from "./highestQualification";
import type { HighestQualificationCategory } from "./highestQualification";

// Mirrors highestQualification.ts internals (kept local so this helper stays
// self-contained if that file changes its private helpers).
const ALIASES: Record<string, HighestQualificationCategory> = {
  phd: "Ph.D",
  doctorofphilosophy: "Ph.D",
  mtech: "M.Tech",
  me: "M.E",
  msc: "M.Sc",
  ma: "M.A",
  mphil: "M.Phil",
  mped: "M.P.Ed",
  msit: "MSIT",
  mba: "MBA",
  btech: "B.Tech",
  bsc: "B.Sc",
};

const RANK: Record<HighestQualificationCategory, number> = {
  "Ph.D": 5,
  "M.Phil": 4,
  "M.Tech": 3,
  "M.E": 3,
  "M.Sc": 3,
  "M.A": 3,
  "M.P.Ed": 3,
  MSIT: 3,
  MBA: 3,
  "B.Tech": 2,
  "B.Sc": 2,
};

function compact(token: string): string {
  return token.replace(/\(.*?\)/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Parse a minimumQualifications entry (e.g. "M.Phil / NET / Ph.D",
 * "Ph.D with NET", "Ph.D with 10 years experience", "Ph.D").
 *
 * - Splits on "/" , "with" (word boundary, case-insensitive) and commas.
 * - Detects a NET/SLET/SET requirement: true only when the raw string contains
 *   the word "with" AND a NET/SLET/SET token (so "A / NET / B" is an
 *   alternative list, not a conjunction).
 * - Maps each split token to a qualification rank via the same ALIASES/RANK
 *   table as highestQualification.ts; tokens like "NET" or "10 years
 *   experience" have no mapping and are ignored for rank.
 * - minRank is the minimum rank among the matched qualifications (so any
 *   alternative at or above the lowest qualifies). When no token maps to a
 *   qualification, minRank is 0 (no qualification gate, only a possible NET
 *   gate).
 */
export function parseRequiredQual(raw: string): { minRank: number; requiresNet: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { minRank: 0, requiresNet: false };

  const hasWith = /\bwith\b/i.test(trimmed);
  const hasNetToken = /\b(net|slet|set)\b/i.test(trimmed);
  const requiresNet = hasWith && hasNetToken;

  // Split on "/", the word "with", and commas. Keep it case-insensitive.
  const rawTokens = trimmed
    .split(/\s*\/\s*|\s*\bwith\b\s*|\s*,\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const ranks: number[] = [];
  for (const token of rawTokens) {
    const cat = ALIASES[compact(token)];
    if (cat) {
      const r = RANK[cat];
      if (r !== undefined) ranks.push(r);
    }
  }

  const minRank = ranks.length > 0 ? Math.min(...ranks) : 0;
  return { minRank, requiresNet };
}

/**
 * Returns true when `candidateRaw` satisfies the qualification described by
 * `requiredRaw`.
 *
 * - `requiredRaw` empty → always true (no norm configured).
 * - Candidate is normalized via `classifyHighestQualification` (so spelling
 *   variants collapse). If the candidate normalizes to "Others" or blank,
 *   the check fails. A fallback split on "with"/"/"/"," is applied for
 *   candidates that include "with NET" (which the classifier treats as a
 *   single token and would otherwise classify as Others).
 * - Whether the candidate "has NET" is detected by a case-insensitive
 *   NET/SLET/SET substring.
 * - Passes when candidate rank ≥ minRank and, if the requirement demands
 *   NET, the candidate string contains NET.
 */
// Keep the import of HIGHEST_QUALIFICATION_OPTIONS referenced so the module
// visibly depends on the shared source of truth (unused at runtime).
void HIGHEST_QUALIFICATION_OPTIONS;

export function isQualificationSufficient(candidateRaw: string, requiredRaw: string): boolean {
  if (!requiredRaw || !requiredRaw.trim()) return true;

  const candidateText = typeof candidateRaw === "string" ? candidateRaw.trim() : "";
  if (!candidateText) return false;

  const candidateHasNet = /\b(net|slet|set)\b/i.test(candidateText);

  const classification = classifyHighestQualification(candidateText);
  let candidateRank = 0;
  let isValidCategory = false;

  if (classification.category !== null && classification.category !== "Others") {
    const cat = classification.category as HighestQualificationCategory;
    candidateRank = RANK[cat] ?? 0;
    isValidCategory = candidateRank > 0;
  } else {
    // Fallback for candidates like "Ph.D with NET" which the classifier
    // treats as a single token ("phdwithnet" → no alias). Split on the same
    // separators as parseRequiredQual and take the best rank found.
    const tokens = candidateText
      .split(/\s*\/\s*|\s*\bwith\b\s*|\s*,\s*|\s*\band\b\s*/i)
      .map((s) => s.trim())
      .filter(Boolean);
    let best = 0;
    for (const t of tokens) {
      const cat = ALIASES[compact(t)];
      if (cat) {
        const r = RANK[cat] ?? 0;
        if (r > best) best = r;
      }
    }
    if (best > 0) {
      candidateRank = best;
      isValidCategory = true;
    }
  }

  if (!isValidCategory) return false;

  const { minRank, requiresNet } = parseRequiredQual(requiredRaw);

  if (candidateRank < minRank) return false;
  if (requiresNet && !candidateHasNet) return false;
  return true;
}
