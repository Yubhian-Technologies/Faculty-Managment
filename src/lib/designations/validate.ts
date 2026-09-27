import { matchOption } from "@/lib/import/fieldConstraints";
import type { DesignationCategory } from "@/types";

const CATEGORY_LABELS: Record<DesignationCategory, string> = {
  FACULTY: "Faculty",
  TECHNICAL: "Technical",
  NON_TECHNICAL: "Non-Technical",
};

// The active designation names this college has curated for one category
// (colleges/{id}/designations - see DesignationCatalogCard). Fetched ONCE per
// caller (a single manual Add/Edit request, or once per whole CSV import
// rather than once per row) and handed to matchDesignation below - kept
// separate from it so a bulk import's per-row loop doesn't refetch the same
// catalog on every row.
export async function fetchActiveDesignationNames(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  category: DesignationCategory
): Promise<string[]> {
  const snap = await db.collection("colleges").doc(collegeId).collection("designations")
    .where("category", "==", category).where("isActive", "==", true).get();
  return snap.docs
    .map((d) => (d.data() as { name?: string }).name)
    .filter((n): n is string => !!n);
}

// Matches a raw designation string against an already-fetched catalog list -
// matchOption normalizes case/punctuation/spacing (so "assistant professor"
// and "Assistant Professor" resolve the same), but only a name the admin
// actually added is accepted - anything else is rejected rather than stored
// as whatever text was typed. Pure (no I/O), so a bulk import can call this
// once per row against one shared list instead of hitting Firestore per row.
export function matchDesignation(
  raw: string,
  allowedDesignations: string[],
  category: DesignationCategory
): { name: string } | { error: string } {
  const trimmed = raw.trim();
  const matched = matchOption(trimmed, allowedDesignations);
  if (!matched) {
    const categoryLabel = CATEGORY_LABELS[category];
    return {
      error: allowedDesignations.length > 0
        ? `Designation "${trimmed}" is not one of the ${categoryLabel} titles your college allows (${allowedDesignations.join(" / ")})`
        : `No ${categoryLabel} designations have been added yet - add at least one under Settings before this can be saved`,
    };
  }
  return { name: matched };
}

// Convenience wrapper for a single-record caller (the manual Faculty/
// Supporting Staff Add/Edit routes) that needs to validate exactly one
// designation and doesn't have a pre-fetched catalog list to reuse - fetches
// then matches. Bulk import routes should call fetchActiveDesignationNames
// once outside their row loop and matchDesignation per row instead, to avoid
// refetching the same catalog on every row.
export async function resolveDesignation(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  category: DesignationCategory,
  raw: string
): Promise<{ name: string } | { error: string }> {
  const allowedDesignations = await fetchActiveDesignationNames(db, collegeId, category);
  return matchDesignation(raw, allowedDesignations, category);
}
