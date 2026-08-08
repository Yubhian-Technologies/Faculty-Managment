// Read-time, best-effort fallbacks for two Academic Profile fields that used
// to be stored as one combined value and are now split - applied only when a
// record still has the old shape and hasn't been re-saved under the new one
// yet. Nothing here touches Firestore; the split values just seed the edit
// form, and saving the form (even untouched) persists the new shape.

// "B.Tech CSE" -> { degree: "B.Tech", branch: "CSE" }. Splits on the first
// space - imprecise for degree names with more words, but good enough to
// pre-fill the new fields for correction rather than leaving them blank.
export function splitDegreeAndBranch(combined: string): { degree: string; branch: string } {
  const trimmed = combined.trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return { degree: trimmed, branch: "" };
  return { degree: trimmed.slice(0, spaceIdx), branch: trimmed.slice(spaceIdx + 1).trim() };
}

// A legacy PreviousInstitution only ever recorded a single "years worked"
// duration, with no reference date. Anchors the guessed range on the
// faculty's joining date here (the most common real case for a "previous
// institution" entry is the job immediately before this one), falling back
// to the current year if no joining date is available.
export function deriveInstitutionYearRange(
  yearsWorked: number | undefined,
  referenceYear: number
): { fromYear: number | undefined; toYear: number | undefined } {
  if (!yearsWorked) return { fromYear: undefined, toYear: undefined };
  return { toYear: referenceYear, fromYear: referenceYear - yearsWorked };
}
