// What an "Organizing Hackathons / Competitions" record needs before it can be
// submitted for verification. One definition, used by the form (to disable
// Submit and list what is missing) and by POST / owner-resubmit PATCH (so a
// request that skips the form is refused too). It mirrors the fields the form
// marks with an asterisk; the document uploads are optional and are not here.

export interface HackathonValidationInput {
  academicYear?: unknown;
  eventTitle?: unknown;
  eventType?: unknown;
  organizingDeptCell?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  durationHours?: unknown;
  venue?: unknown;
  levelOfEvent?: unknown;
  themeDomain?: unknown;
  noOfProblemStatements?: unknown;
  teamsRegisteredInternal?: unknown;
  teamsRegisteredExternal?: unknown;
  participantsInternal?: unknown;
  participantsExternal?: unknown;
  ideasPresentedCount?: unknown;
  pocsPresentedCount?: unknown;
  productsPresentedCount?: unknown;
  evaluators?: unknown;
  facultyCoordinators?: unknown;
  ideasUploadedYukti?: unknown;
  ideasVerifiedRecommendedYukti?: unknown;
  prototypesUploadedYukti?: unknown;
  prototypesVerifiedRecommendedYukti?: unknown;
  remarks?: unknown;
}

const TEXT_FIELDS: [keyof HackathonValidationInput, string][] = [
  ["academicYear", "Academic Year"],
  ["eventTitle", "Event Title"],
  ["eventType", "Event Type"],
  ["levelOfEvent", "Level of Event"],
  ["organizingDeptCell", "Organizing Department / Cell"],
  ["startDate", "Start Date"],
  ["endDate", "End Date"],
  ["venue", "Venue"],
  ["themeDomain", "Theme / Domain"],
  ["remarks", "Remarks"],
];

// Counts: a whole number, zero allowed (a blank is not a zero).
const COUNT_FIELDS: [keyof HackathonValidationInput, string][] = [
  ["noOfProblemStatements", "No. of Problem Statements"],
  ["teamsRegisteredInternal", "Teams Registered - Internal"],
  ["teamsRegisteredExternal", "Teams Registered - External"],
  ["participantsInternal", "Participants - Internal"],
  ["participantsExternal", "Participants - External"],
  ["ideasPresentedCount", "Ideas Presented"],
  ["pocsPresentedCount", "PoC's Presented"],
  ["productsPresentedCount", "Products/Prototypes Presented"],
  ["ideasUploadedYukti", "Ideas Uploaded in YUKTI"],
  ["ideasVerifiedRecommendedYukti", "Ideas Verified & Recommended"],
  ["prototypesUploadedYukti", "Prototypes Uploaded in YUKTI"],
  ["prototypesVerifiedRecommendedYukti", "Prototypes Verified & Recommended"],
];

const filledText = (v: unknown) => typeof v === "string" && v.trim() !== "";
const isCount = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;

function incompleteRows(list: unknown, keys: [string, string][], noun: string): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  list.forEach((row, i) => {
    const r = (row ?? {}) as Record<string, unknown>;
    for (const [key, label] of keys) {
      if (!filledText(r[key])) out.push(`${noun} ${i + 1} - ${label}`);
    }
  });
  return out;
}

/** Labels of everything still missing or invalid, in form order; empty = ready to submit. */
export function hackathonMissingFields(input: HackathonValidationInput): string[] {
  const missing: string[] = [];
  for (const [key, label] of TEXT_FIELDS) {
    if (!filledText(input[key])) missing.push(label);
  }
  // Duration is hours of a real event: it must be more than zero.
  const d = input.durationHours;
  if (typeof d !== "number" || !Number.isFinite(d) || d <= 0) missing.push("Duration (Hrs)");
  for (const [key, label] of COUNT_FIELDS) {
    if (!isCount(input[key])) missing.push(label);
  }
  missing.push(...incompleteRows(input.evaluators, [["name", "Name"], ["affiliation", "Affiliation"]], "Evaluator"));
  missing.push(...incompleteRows(
    input.facultyCoordinators,
    [["name", "Name"], ["designation", "Designation"], ["departmentOrCell", "Department/Cell"]],
    "Faculty Coordinator"
  ));
  if (filledText(input.startDate) && filledText(input.endDate) && String(input.endDate) < String(input.startDate)) {
    missing.push("End Date must be on or after Start Date");
  }
  return missing;
}

/** One sentence for an API 400. */
export function hackathonMissingMessage(missing: string[]): string {
  return `Please complete the required fields: ${missing.join(", ")}`;
}
