// A record saved before "Resource Persons - Details" became a per-person
// list still has this stored as a single free-text string in Firestore even
// though the type now says string[] - every reader normalizes through here
// rather than trusting the type at runtime (a raw string would crash .map()/
// spread as if it were an array of characters).
//
// Moved out of the "use client" TrainingEntryFields.tsx (where it also still
// lives, re-exported) because exportFacultyCsv.ts's buildRow() - reused
// server-side by src/lib/faculty/profileCompletion.ts - cannot import a
// function from a client-component module: Next.js throws "Attempted to call
// X from the server but X is on the client" the moment that import chain is
// evaluated in a route handler.
export function normalizeResourcePersonsDetails(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}
