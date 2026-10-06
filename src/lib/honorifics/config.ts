// Identity key for "is this the same honorific?" - case/punctuation-insensitive
// so "Dr." and a hand-typed "dr" count as the same entry. Used by the
// Honorific Catalog's duplicate check (api/college/honorifics), same
// reasoning as designationKey (lib/designations/config.ts).
export function honorificKey(value: string | undefined | null): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
