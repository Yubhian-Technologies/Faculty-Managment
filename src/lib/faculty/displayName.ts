// "Display Name" tab of a faculty member's profile: the name as it should be printed - the surname's short form
// (at most 2 capital letters) and the rest of the name (capitals). Both are mandatory once the tab is saved.
// Stored on the faculty record as `displaySurname` / `displayName`.

export const DISPLAY_SURNAME_MAX = 2;

/** What a field shows while typing: capitals only; the surname short form is cut to 2 characters. */
export function normalizeDisplaySurname(raw: string): string {
  return raw.toUpperCase().slice(0, DISPLAY_SURNAME_MAX);
}

export function normalizeDisplayName(raw: string): string {
  return raw.toUpperCase();
}

/** The cleaned values to store, or the message to show when one is missing / not allowed. */
export function resolveDisplayName(input: { displaySurname?: unknown; displayName?: unknown }): { ok: true; displaySurname: string; displayName: string } | { ok: false; error: string } {
  const surname = typeof input.displaySurname === "string" ? input.displaySurname.trim().toUpperCase() : "";
  const name = typeof input.displayName === "string" ? input.displayName.trim().replace(/\s+/g, " ").toUpperCase() : "";
  if (!surname) return { ok: false, error: "Surname (short form) is required" };
  if (surname.length > DISPLAY_SURNAME_MAX) return { ok: false, error: `Surname (short form) can have at most ${DISPLAY_SURNAME_MAX} characters` };
  if (!name) return { ok: false, error: "Name is required" };
  return { ok: true, displaySurname: surname, displayName: name };
}
