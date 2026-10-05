import { matchOption } from "@/lib/import/fieldConstraints";

// The active honorific names this college has curated (colleges/{id}/
// honorifics - see HonorificsCatalogCard). Fetched ONCE per caller (a single
// manual Add request, or once per whole CSV import rather than once per row)
// and handed to matchHonorific below - same split as fetchActiveDesignationNames/
// matchDesignation (lib/designations/validate.ts), which this mirrors.
export async function fetchActiveHonorificNames(
  db: FirebaseFirestore.Firestore,
  collegeId: string
): Promise<string[]> {
  const snap = await db.collection("colleges").doc(collegeId).collection("honorifics")
    .where("isActive", "==", true).get();
  return snap.docs
    .map((d) => (d.data() as { name?: string }).name)
    .filter((n): n is string => !!n);
}

// Matches a raw honorific string against an already-fetched catalog list -
// matchOption normalizes case/punctuation/spacing (so "dr" and "Dr." resolve
// the same), but only a name the Principal actually added is accepted.
// Honorific is always OPTIONAL - callers only invoke this when a non-blank
// value was actually given, never to enforce presence.
export function matchHonorific(raw: string, allowedHonorifics: string[]): { name: string } | { error: string } {
  const trimmed = raw.trim();
  const matched = matchOption(trimmed, allowedHonorifics);
  if (!matched) {
    return {
      error: allowedHonorifics.length > 0
        ? `Honorific "${trimmed}" is not one of your college's honorifics (${allowedHonorifics.join(" / ")})`
        : "No honorifics have been added yet - add at least one under Principal Settings before this can be saved",
    };
  }
  return { name: matched };
}

// Convenience wrapper for a single-record caller (the manual Add Faculty
// route) that needs to validate exactly one honorific and doesn't have a
// pre-fetched catalog list to reuse. Bulk import should call
// fetchActiveHonorificNames once outside its row loop and matchHonorific per
// row instead, to avoid refetching the same catalog on every row.
export async function resolveHonorific(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  raw: string
): Promise<{ name: string } | { error: string }> {
  const allowed = await fetchActiveHonorificNames(db, collegeId);
  return matchHonorific(raw, allowed);
}
