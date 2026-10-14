// What an Innovation record needs before it can be submitted for verification.
// Mirrors the fields the form marks with an asterisk (including the ones that
// only appear once an answer is Yes / Faculty / Student). Used by the form (to
// gate Submit and list what is missing) and by POST / owner-resubmit PATCH.
// The YUKTI screenshot is optional, as the form leaves it unstarred.

export interface InnovationValidationInput {
  academicYear?: unknown;
  innovatorType?: unknown;
  facultyInvolvedCount?: unknown;
  facultyMembers?: unknown;
  studentName?: unknown;
  studentRegdNo?: unknown;
  studentYearOfStudy?: unknown;
  studentDepartment?: unknown;
  facultyMentorName?: unknown;
  innovationTitle?: unknown;
  innovationType?: unknown;
  trlLevel?: unknown;
  problemStatement?: unknown;
  briefDescription?: unknown;
  prototypeDeveloped?: unknown;
  prototypeDetails?: unknown;
  businessModelDeveloped?: unknown;
  businessModelDetails?: unknown;
  startupFormed?: unknown;
  startupName?: unknown;
  incubationName?: unknown;
  yuktiId?: unknown;
  verifiedRecommendedYukti?: unknown;
  presentedInCompetition?: unknown;
  competitionName?: unknown;
  organizedBy?: unknown;
  remarks?: unknown;
}

const filled = (v: unknown) => typeof v === "string" ? v.trim() !== "" : v !== undefined && v !== null && v !== "";
const isYes = (v: unknown) => v === "YES";

/** Labels of everything still missing, in form order; empty = ready to submit. */
export function innovationMissingFields(b: InnovationValidationInput): string[] {
  const missing: string[] = [];
  const need = (value: unknown, label: string) => { if (!filled(value)) missing.push(label); };

  need(b.academicYear, "Academic Year");
  need(b.innovatorType, "Type of Innovation");

  if (b.innovatorType === "FACULTY") {
    const c = b.facultyInvolvedCount;
    if (typeof c !== "number" || !Number.isInteger(c) || c < 0) missing.push("No. of Faculty Involved");
    if (Array.isArray(b.facultyMembers)) {
      b.facultyMembers.forEach((row, i) => {
        const r = (row ?? {}) as Record<string, unknown>;
        if (!filled(r.name)) missing.push(`Faculty ${i + 1} - Name`);
        if (!filled(r.department)) missing.push(`Faculty ${i + 1} - Dept.`);
        if (!filled(r.contribution)) missing.push(`Faculty ${i + 1} - Contribution`);
      });
    }
  } else if (b.innovatorType === "STUDENT") {
    need(b.studentName, "Name of the Student");
    need(b.studentRegdNo, "Regd. No.");
    need(b.studentYearOfStudy, "Year of Study");
    need(b.studentDepartment, "Department");
    need(b.facultyMentorName, "Name of the Faculty Mentor");
  }

  need(b.innovationTitle, "Innovation Title");
  need(b.innovationType, "Innovation Type");
  need(b.trlLevel, "TRL Level");
  need(b.problemStatement, "Problem Statement");
  need(b.briefDescription, "Brief Description");

  need(b.prototypeDeveloped, "Prototype Developed");
  if (isYes(b.prototypeDeveloped)) need(b.prototypeDetails, "Prototype Details");
  need(b.businessModelDeveloped, "Business Model Developed");
  if (isYes(b.businessModelDeveloped)) need(b.businessModelDetails, "Business Model Details");
  need(b.startupFormed, "Start-up Formed");
  if (isYes(b.startupFormed)) {
    need(b.startupName, "Start-up Name");
    need(b.incubationName, "Name of the Incubation");
    need(b.yuktiId, "YUKTI ID");
  }
  need(b.verifiedRecommendedYukti, "Verified & Recommended in YUKTI");

  need(b.presentedInCompetition, "Presented in any Competition");
  if (isYes(b.presentedInCompetition)) {
    need(b.competitionName, "Name of the Competition");
    need(b.organizedBy, "Organized By");
  }
  need(b.remarks, "Remarks");
  return missing;
}

/** One sentence for an API 400. */
export function innovationMissingMessage(missing: string[]): string {
  return `Please complete the required fields: ${missing.join(", ")}`;
}
