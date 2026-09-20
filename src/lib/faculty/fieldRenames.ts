// Single source of truth for renaming the legacy Faculty Details storage keys to
// the names the Faculty Details UI labels use (see the "Course" / "Year of
// Passing" / "Hall Ticket Number" ... columns below).
//
// Used two ways, with the exact same functions:
//   1. Read-time: migrateAcademicProfile()/migrateFacultyDoc() lift a record that
//      still has the old key names into the new shape, so the app keeps working
//      on un-migrated Firestore docs.
//   2. One-off migration: scripts/migrate-faculty-field-names.mjs imports this
//      file directly and writes the result back.
//
// Both are idempotent: a record already in the new shape passes through
// untouched, and when a record somehow has BOTH the old and the new key, the
// new key wins and the old one is dropped.
//
// Keep this file dependency-free and TypeScript-erasable (no enums, no `@/`
// imports) - the migration script loads it with Node's native type stripping.

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

// ─── Rename tables (old key -> new key) ────────────────────────────────────

// academicProfile.* root keys
export const ACADEMIC_PROFILE_ROOT_RENAMES: Record<string, string> = {
  // Academic Qualification
  researchAreas: "researchAreasInterests",
  highSchoolDetails: "secondaryEducation",
  intermediateDetails: "intermediateDiplomaIti",
  postDoctoralDetails: "postdoctoralFellowshipDetails",
  schoolQualifications: "educationalQualifications",
  qualifyingExamQualified: "netSletSetGateOthers",
  qualifyingExam: "qualifiedExam",
  otherQualifyingExam: "pleaseSpecifyExam",
  qualifyingExamScore: "examScore",
  qualifyingExamYear: "qualifiedYear",
  // Professional Experience
  previousInstitutions: "academicExperience",
  industryExperienceEntries: "industryExperience",
  researchExperienceEntries: "researchExperience",
  primaryIndustryRole: "industryRolesResponsibilities",
  primaryResearchRole: "researchRolesResponsibilities",
  // Professional Development
  labsEstablished: "newLabsEstablished",
  adminResponsibilityEntries: "academicResponsibilities",
  trainingEntries: "fdpsWorkshopsMoocsCertifications",
  awardEntries: "awardsRecognition",
  // Financial Standing
  presentSalary: "monthlySalary",
  fundingConsultancyRevenue: "fundingConsultancyRevenueGeneration",
};

// DegreeDetail / StaffQualification. yearOfCompletion is handled separately
// because its new name depends on the level (Year of Passing vs Year of Award).
export const DEGREE_KEY_RENAMES: Record<string, string> = {
  degree: "course",
  universityOrInstitute: "institutionName",
  location: "place",
  percentageOrDivision: "percentageCgpa",
  guideOrSupervisorName: "nameOfTheGuideSupervisor",
  certificateNumber: "hallTicketNumber",
};

export const TRAINING_ENTRY_KEY_RENAMES: Record<string, string> = {
  otherType: "pleaseSpecifyType",
  role: "participatedOrConducted",
  title: "titleOfTheProgram",
  organizer: "nameOfTheFacultyCoordinator",
  durationDays: "duration",
  durationWeeks: "numberOfWeeks",
  levelOfProgram: "nationalInternational",
  mode: "modeOfTheProgram",
  beneficiaryType: "beneficiaries",
  beneficiaryTotalCount: "totalCount",
  beneficiaryInternalCount: "internalCount",
  beneficiaryExternalCount: "externalCount",
  coConductors: "coConductingFaculty",
};

export const MEMBERSHIP_KEY_RENAMES: Record<string, string> = {
  otherName: "bodyName",
  validity: "membershipValidity",
  sinceDate: "memberSince",
};

export const AWARD_ENTRY_KEY_RENAMES: Record<string, string> = {
  title: "titleOfAward",
  awardingBody: "awardingAgencyBody",
  dateAwarded: "dateOfAward",
  level: "stateNationalInternational",
};

export const PROMOTION_KEY_RENAMES: Record<string, string> = {
  orderUrl: "promotionOrderUrl",
};

// Flat personal/statutory keys, shared by facultyMembers, users and supportingStaff docs.
export const PERSONAL_KEY_RENAMES: Record<string, string> = {
  passportNumber: "passportNo",
  bankAccountNo: "bankAccountNumber",
  emergencyContactPhone: "emergencyContactMobileNo",
  permanentSameAsTemporary: "permanentAddressSameAsTemporary",
};

// facultyMembers-only top-level keys.
export const FACULTY_DOC_KEY_RENAMES: Record<string, string> = {
  qualification: "highestQualification",
  experienceYears: "totalYearsOfExperience",
};

// academicProfile containers holding a DegreeDetail (or a list of them), and
// whether each is a Doctoral/Post-Doctoral entry (Year of Award) or not (Year of Passing).
const DEGREE_CONTAINERS: Record<string, { list: boolean; doctoral: boolean }> = {
  secondaryEducation: { list: false, doctoral: false },
  intermediateDiplomaIti: { list: false, doctoral: false },
  ugDetails: { list: false, doctoral: false },
  additionalUgDetails: { list: true, doctoral: false },
  pgDetails: { list: false, doctoral: false },
  additionalPgDetails: { list: true, doctoral: false },
  phdDetails: { list: false, doctoral: true },
  additionalPhdDetails: { list: true, doctoral: true },
  postdoctoralFellowshipDetails: { list: false, doctoral: true },
  educationalQualifications: { list: true, doctoral: false },
};

// ─── Primitives ────────────────────────────────────────────────────────────

// Returns a copy of `obj` with keys renamed per `map`. A new key that already
// exists on `obj` wins over its legacy twin.
function renameKeys(obj: Obj, map: Record<string, string>): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(obj)) {
    const nk = map[k];
    if (nk === undefined) {
      out[k] = v;
    } else if (!(nk in obj)) {
      out[nk] = v;
    }
  }
  return out;
}

function mapList(value: unknown, fn: (item: Obj) => Obj): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => (isObj(item) ? fn(item) : item));
}

// ─── Per-shape migrations (each exported for the Supporting Staff paths too) ─

export function migrateDegree(d: Obj, doctoral: boolean): Obj {
  const out = renameKeys(d, DEGREE_KEY_RENAMES);
  if ("yearOfCompletion" in out) {
    const targetKey = doctoral ? "yearOfAward" : "yearOfPassing";
    if (!(targetKey in out)) out[targetKey] = out.yearOfCompletion;
    delete out.yearOfCompletion;
  }
  return out;
}

export function migrateStaffQualifications(list: unknown): unknown {
  return mapList(list, (q) => migrateDegree(q, false));
}

export function migrateTrainingEntries(list: unknown): unknown {
  return mapList(list, (t) => renameKeys(t, TRAINING_ENTRY_KEY_RENAMES));
}

export function migrateAwardEntries(list: unknown): unknown {
  return mapList(list, (a) => renameKeys(a, AWARD_ENTRY_KEY_RENAMES));
}

export function migrateMemberships(list: unknown): unknown {
  return mapList(list, (m) => renameKeys(m, MEMBERSHIP_KEY_RENAMES));
}

// ─── Experience Roles/Responsibilities -> per-entry ────────────────────────

// Which entry list each legacy shared root-level Roles/Responsibilities field belongs to.
export const ROLE_FIELD_TO_LIST = [
  { role: "teachingRolesResponsibilities", list: "academicExperience" },
  { role: "industryRolesResponsibilities", list: "industryExperience" },
  { role: "researchRolesResponsibilities", list: "researchExperience" },
] as const;

function nonEmptyText(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

// Sort key for "most recent": an entry with no end date is ongoing (latest), otherwise the
// end date, then the start date. Years-only legacy values count as Jan 1.
function endKey(e: Obj): string {
  const to = nonEmptyText(e.toDate) ? e.toDate : e.toYear ? `${e.toYear}-01-01` : "";
  return to || "9999-12-31";
}
function startKey(e: Obj): string {
  return (nonEmptyText(e.fromDate) ? e.fromDate : e.fromYear ? `${e.fromYear}-01-01` : "") as string;
}

// Index of the most recent entry (ties -> the later one in the list); -1 for an empty list.
export function latestEntryIndex(entries: unknown[]): number {
  let best = -1;
  entries.forEach((raw, i) => {
    const e = isObj(raw) ? raw : {};
    if (best === -1) { best = i; return; }
    const b = entries[best] as Obj;
    const [ek, bk, es, bs] = [endKey(e), endKey(b), startKey(e), startKey(b)];
    if (ek > bk || (ek === bk && es >= bs)) best = i;
  });
  return best;
}

// Moves each shared root-level Roles/Responsibilities text onto the most recent entry of its
// own list, then drops the root field. Never loses text: when there is no entry to hold it, or
// the latest entry already carries different text, the root field is left in place.
function liftRolesIntoEntries(out: Obj): void {
  for (const { role, list } of ROLE_FIELD_TO_LIST) {
    const text = out[role];
    if (!nonEmptyText(text)) { if (role in out && (text === undefined || text === "")) delete out[role]; continue; }
    const entries = out[list];
    if (!Array.isArray(entries) || entries.length === 0) continue;
    const i = latestEntryIndex(entries);
    const target = entries[i];
    if (!isObj(target)) continue;
    const existing = target.rolesResponsibilities;
    if (nonEmptyText(existing) && existing.trim() !== text.trim()) continue;
    if (!nonEmptyText(existing)) out[list] = entries.map((e, idx) => (idx === i ? { ...target, rolesResponsibilities: text } : e));
    delete out[role];
  }
}

// ─── Whole-record migrations ───────────────────────────────────────────────

// Lifts a FacultyProfileFields object (facultyMembers.academicProfile or
// users.academicProfile) from the old key names to the new ones.
export function migrateAcademicProfile(ap: unknown): unknown {
  if (!isObj(ap)) return ap;
  const out = renameKeys(ap, ACADEMIC_PROFILE_ROOT_RENAMES);

  for (const [key, { list, doctoral }] of Object.entries(DEGREE_CONTAINERS)) {
    if (!(key in out)) continue;
    const v = out[key];
    if (list) {
      out[key] = mapList(v, (d) => migrateDegree(d, doctoral));
    } else if (isObj(v)) {
      out[key] = migrateDegree(v, doctoral);
    }
  }

  // Teaching Roles/Responsibilities used to be nested under teachingAssignment;
  // it now sits at the root beside its Industry/Research siblings.
  const ta = out.teachingAssignment;
  if (isObj(ta) && "primaryTeachingRole" in ta) {
    const { primaryTeachingRole, ...restTa } = ta;
    if (!("teachingRolesResponsibilities" in out)) out.teachingRolesResponsibilities = primaryTeachingRole;
    out.teachingAssignment = restTa;
  }
  liftRolesIntoEntries(out);

  // Only touch entry lists that are actually present - Firestore rejects an
  // explicit `undefined`, so an absent key has to stay absent.
  const applyToKey = (key: string, fn: (v: unknown) => unknown) => {
    if (key in out) out[key] = fn(out[key]);
  };
  applyToKey("fdpsWorkshopsMoocsCertifications", migrateTrainingEntries);
  applyToKey("awardsRecognition", migrateAwardEntries);
  applyToKey("professionalMemberships", migrateMemberships);
  applyToKey("promotionHistory", (v) => mapList(v, (p) => renameKeys(p, PROMOTION_KEY_RENAMES)));
  return out;
}

// Flat personal keys (works for facultyMembers, users and supportingStaff docs).
export function migratePersonalFlat(doc: Obj): Obj {
  return renameKeys(doc, PERSONAL_KEY_RENAMES);
}

// A whole facultyMembers doc: top-level renames, personal keys, academicProfile.
export function migrateFacultyDoc(doc: Obj): Obj {
  let out = renameKeys(doc, FACULTY_DOC_KEY_RENAMES);
  out = migratePersonalFlat(out);
  if ("academicProfile" in out) out.academicProfile = migrateAcademicProfile(out.academicProfile);
  return out;
}

// A whole users doc (FMSUser): personal keys + academicProfile only.
export function migrateUserDoc(doc: Obj): Obj {
  const out = migratePersonalFlat(doc);
  if ("academicProfile" in out) out.academicProfile = migrateAcademicProfile(out.academicProfile);
  return out;
}

// A whole supportingStaff doc: personal keys + the three shared-shape lists
// under supportingStaffProfile. (The flat qualification/experienceYears keys on
// this collection are NOT renamed - they're a separate type from FacultyMember.)
export function migrateSupportingStaffDoc(doc: Obj): Obj {
  const out = migratePersonalFlat(doc);
  const sp = out.supportingStaffProfile;
  if (isObj(sp)) {
    const next: Obj = { ...sp };
    if (next.qualifications !== undefined) next.qualifications = migrateStaffQualifications(next.qualifications);
    const ntp = next.nonTechnicalProfile;
    if (isObj(ntp)) {
      const nextNtp: Obj = { ...ntp };
      if (nextNtp.training !== undefined) nextNtp.training = migrateTrainingEntries(nextNtp.training);
      if (nextNtp.achievements !== undefined) nextNtp.achievements = migrateAwardEntries(nextNtp.achievements);
      next.nonTechnicalProfile = nextNtp;
    }
    out.supportingStaffProfile = next;
  }
  return out;
}
