import { ROSTER_FIELDS } from "@/lib/students/rosterFields";

// What the student Edit save answers with (PATCH /api/college/students/[id], `details`), and how the form reads it.
//
//   success  { ok: true,  saved: ["name", "mobileNo"], rejected: [], ignored: [] }
//   refusal  { error, saved: [], rejected: [{ field, label, message }], fieldErrors: { field: message } }   (HTTP 4xx)
//
// A refusal means NOTHING was saved - every problem is listed at once so they can be fixed together.

export interface EditProblem {
  field: string;
  label: string;
  message: string;
}

export interface EditSaveResponse {
  ok?: boolean;
  error?: string;
  saved?: string[];
  rejected?: EditProblem[];
  /** Sent but left out on purpose (e.g. a Regd. No from a role that may not change it); the rest still saved. */
  ignored?: EditProblem[];
  fieldErrors?: Record<string, string>;
}

const LABELS = new Map<string, string>([...ROSTER_FIELDS.map((f) => [f.key, f.label] as const), ["courseId", "Course"]]);
export const editFieldLabel = (key: string): string => LABELS.get(key) ?? key;

/** The problems an answer reports, from `rejected` (or, for an older answer, `fieldErrors`). Empty when it names none. */
export function problemsFromResponse(json: EditSaveResponse | null | undefined): EditProblem[] {
  if (!json) return [];
  if (Array.isArray(json.rejected) && json.rejected.length > 0) return json.rejected;
  if (json.fieldErrors && typeof json.fieldErrors === "object") {
    return Object.entries(json.fieldErrors).map(([field, message]) => ({ field, label: editFieldLabel(field), message }));
  }
  return [];
}

/** { field: message } for the boxes to mark. */
export function fieldErrorMap(problems: EditProblem[]): Record<string, string> {
  return Object.fromEntries(problems.map((p) => [p.field, p.message]));
}

/** "Name, Student Mobile No and 2 more" - the fields a save changed, for the success message. */
export function savedSummary(saved: string[] | undefined, max = 4): string {
  const labels = Array.from(new Set((saved ?? []).map(editFieldLabel)));
  if (labels.length === 0) return "";
  if (labels.length <= max) return labels.join(", ");
  return `${labels.slice(0, max).join(", ")} and ${labels.length - max} more`;
}
