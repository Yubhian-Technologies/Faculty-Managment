// Full-detail faculty CSV export - flattens a FacultyMember (+ academicProfile)
// into whichever columns the HOD picked in ExportFacultyDialog, against the
// field catalogue in src/lib/faculty/csvColumns.ts (EXPORT_FIELDS). Export-only:
// the bulk-import template accepts a much smaller column set (getFacultyImportColumns -
// core identity/employment fields), so this isn't round-trippable back through import.

import { toCSV, downloadCSV } from "@/lib/utils/csv";
import { toDateInputValue } from "@/lib/utils";
import { EXPORT_FIELDS, type ExportField, type ExportGroupField } from "@/lib/faculty/csvColumns";
import { designationLabel } from "@/lib/designations/config";
import {
  ADMIN_RESPONSIBILITY_CATEGORY_LABELS, TRAINING_ENTRY_TYPE_LABELS, TRAINING_PARTICIPATION_ROLE_LABELS, EMPLOYEE_CATEGORY_LABELS,
  PROFESSIONAL_BODY_LABELS, AWARD_CATEGORY_LABELS, QUALIFYING_EXAM_LABELS, RELIGION_LABELS, CASTE_LABELS,
} from "@/types";
import type {
  FacultyMember, FacultyProfileFields, DegreeDetail, StaffQualification, CourseAssignment, Publication,
  PreviousInstitution, LabEstablished, AuthoredBook, PromotionRecord,
  AdminResponsibilityEntry, TrainingEntry, ProfessionalMembership, AwardEntry, Religion, Caste,
} from "@/types";
import { allPreviousExperienceEntries, totalYearsOfExperience } from "@/lib/faculty/experienceCalc";

function s(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

function yesNo(v: boolean | undefined): string {
  return v === undefined ? "" : v ? "Yes" : "No";
}

const PHD_STATUS_LABELS: Record<string, string> = { AWARDED: "Awarded", PURSUING: "Pursuing" };
const PHD_MODE_LABELS: Record<string, string> = { FULL_TIME: "Full-Time", PART_TIME: "Part-Time" };

// ─── Group cell extractors - one entry -> its ordered sub-field values ─────
// Each returns values in the same order as the matching group's
// `subFieldLabels` in csvColumns.ts.

function degreeCells(d: DegreeDetail): string[] {
  return [d.degree ?? "", d.branch ?? "", d.universityOrInstitute ?? "", d.percentageOrDivision ?? "", d.yearOfCompletion ? String(d.yearOfCompletion) : ""];
}

// PhD entries take Specialization instead of Branch/Percentage-CGPA (see
// DegreeFields in ProfileFieldPrimitives.tsx).
function phdDegreeCells(d: DegreeDetail): string[] {
  return [d.degree ?? "", d.specialization || d.branch || "", d.universityOrInstitute ?? "", d.yearOfCompletion ? String(d.yearOfCompletion) : ""];
}

// School-level entries (10th/12th): `degree` holds the Qualification name,
// `universityOrInstitute` holds the School/College name (see DegreeFields'
// isSchoolLevel branch in ProfileFieldPrimitives.tsx).
function schoolDegreeCells(d: DegreeDetail): string[] {
  return [d.degree ?? "", d.board ?? "", d.universityOrInstitute ?? "", d.percentageOrDivision ?? "", d.yearOfCompletion ? String(d.yearOfCompletion) : ""];
}

function staffQualificationCells(q: StaffQualification): string[] {
  return [q.level ?? "", q.degree ?? "", q.universityOrInstitute ?? "", q.percentageOrDivision ?? "", q.yearOfCompletion ? String(q.yearOfCompletion) : ""];
}

// Prefers the real from/to dates; falls back to the legacy year-only shape
// for a record that hasn't been re-saved since (same fallback PersonalDetails/
// ProfileFieldsView use - see PreviousInstitution's own doc-comment).
function experienceCells(p: PreviousInstitution): string[] {
  const fromDate = p.fromDate ?? (p.fromYear ? String(p.fromYear) : "");
  const toDate = p.toDate ?? (p.toYear ? String(p.toYear) : "");
  return [
    p.institutionName ?? "", p.designation ?? "", fromDate, toDate,
    p.joiningSalary !== undefined ? String(p.joiningSalary) : "",
    p.leavingSalary !== undefined ? String(p.leavingSalary) : "",
    p.reasonForLeaving ?? "",
    p.nocObtained === "YES" ? "Yes" : p.nocObtained === "NO" ? "No" : "",
  ];
}

function promotionCells(p: PromotionRecord): string[] {
  return [p.designation ? designationLabel(p.designation) : "", p.fromDate ?? "", p.toDate ?? ""];
}

function courseCells(c: CourseAssignment): string[] {
  return [c.code ?? "", c.name ?? "", c.weeklyCreditHours ? String(c.weeklyCreditHours) : ""];
}

function publicationCells(p: Publication): string[] {
  return [p.title ?? "", p.coAuthors ?? "", p.journalOrConference ?? "", p.publicationYear ? String(p.publicationYear) : "", p.indexing ?? ""];
}

function bookCells(b: AuthoredBook): string[] {
  return [b.title ?? "", b.publisher ?? "", b.year ? String(b.year) : ""];
}

function labCells(l: LabEstablished): string[] {
  return [l.facilityDetails ?? "", l.outcomes ?? ""];
}

function adminRespCells(a: AdminResponsibilityEntry): string[] {
  const fromYear = a.fromDate ?? (a.fromYear ? String(a.fromYear) : "");
  const toYear = a.toDate ?? (a.toYear ? String(a.toYear) : "");
  return [a.category === "OTHER" ? (a.otherCategory ?? "Other") : (ADMIN_RESPONSIBILITY_CATEGORY_LABELS[a.category] ?? a.category), a.description ?? "", fromYear, toYear];
}

function trainingCells(t: TrainingEntry): string[] {
  const year = t.fromDate ? String(new Date(t.fromDate).getFullYear()) : (t.year ? String(t.year) : "");
  return [
    t.type === "OTHER" ? (t.otherType ?? "Other") : (TRAINING_ENTRY_TYPE_LABELS[t.type] ?? t.type),
    t.role ? TRAINING_PARTICIPATION_ROLE_LABELS[t.role] : "",
    t.title ?? "", t.organizer ?? "", year,
    t.durationDays ? String(t.durationDays) : "",
  ];
}

function membershipCells(m: ProfessionalMembership): string[] {
  const since = m.sinceYear ? String(m.sinceYear) : (m.sinceDate ? String(new Date(m.sinceDate).getFullYear()) : (m.sinceMonthYear ?? ""));
  return [PROFESSIONAL_BODY_LABELS[m.body] ?? m.body, m.otherName ?? "", m.membershipId ?? "", since];
}

function awardCells(a: AwardEntry): string[] {
  const year = a.dateAwarded ? String(new Date(a.dateAwarded).getFullYear()) : (a.year ? String(a.year) : "");
  return [a.category === "OTHER" ? (a.otherCategory ?? "Other") : (AWARD_CATEGORY_LABELS[a.category] ?? a.category), a.title ?? "", a.awardingBody ?? "", year];
}

// ─── Combining multiple entries of the same group into one CSV cell ───────
// Matches the Add/Edit form's own numbering convention for a repeated entry
// (see DegreeFieldsList in ProfileFieldPrimitives.tsx, `"${label} ${i + 2}"`) -
// here every entry (including the first) is numbered, "<Label> 1", "<Label> 2", ...
// Entries whose every sub-field is blank are skipped entirely - a group with
// zero real entries exports as an empty cell, not a blank "<Label> 1: ...".
const FIELD_BY_KEY = new Map<string, ExportField>(EXPORT_FIELDS.map((f) => [f.key, f]));

function combineGroup(key: string, entries: string[][]): string {
  const field = FIELD_BY_KEY.get(key) as ExportGroupField | undefined;
  if (!field) return "";
  const labels = field.subFieldLabels;
  const lines: string[] = [];
  let n = 0;
  for (const cells of entries) {
    if (cells.every((c) => !c)) continue;
    n++;
    const parts = labels.map((lbl, i) => `${lbl}: ${cells[i] ?? ""}`);
    lines.push(`${field.label} ${n}: ${parts.join(" | ")}`);
  }
  return lines.join("\n");
}

function degreeList(primary: DegreeDetail | undefined, additional: DegreeDetail[] | undefined): DegreeDetail[] {
  return [primary, ...(additional ?? [])].filter((d): d is DegreeDetail => !!d);
}

function buildRow(faculty: FacultyMember, teachingSummary: string): Record<string, string> {
  const p: Partial<FacultyProfileFields> = faculty.academicProfile ?? {};
  const teaching = p.teachingAssignment;

  // Internal (time served since Date of Joining) / External (Academic +
  // Industry + Research Experience entries combined) - computed live the
  // same way as the faculty profile page (FacultyProfileHub), not read from
  // a separately-stored, rarely-written field. Rounded to one decimal place,
  // same convention as experienceYears (see totalPreviousExperienceYears).
  function decimalYears(d: { years: number; months: number; days: number }): number {
    return Math.round((d.years + d.months / 12 + d.days / 365) * 10) / 10;
  }
  const previousExperienceEntries = allPreviousExperienceEntries(p);
  const internalExperience = decimalYears(totalYearsOfExperience(undefined, faculty.joiningDate));
  const externalExperience = decimalYears(totalYearsOfExperience(previousExperienceEntries, undefined));

  const row: Record<string, string> = {
    // ─── Identity & Employment ───────────────────────────────────────────
    employeeId: s(faculty.employeeId),
    legalName: s(faculty.legalName),
    name: s(faculty.name),
    apaarFacultyId: s(faculty.apaarFacultyId),
    collegeEmail: s(faculty.collegeEmail),
    designation: s(faculty.designation),
    qualification: s(faculty.qualification),
    specialization: s(faculty.specialization),
    experienceYears: s(faculty.experienceYears),
    internalExperience: faculty.joiningDate ? s(internalExperience) : "",
    externalExperience: previousExperienceEntries.length > 0 ? s(externalExperience) : "",
    joiningDate: toDateInputValue(faculty.joiningDate),
    aicteFacultyId: s(faculty.aicteFacultyId),
    aicteEligible: yesNo(faculty.aicteEligible),
    email: s(faculty.email),
    phone: s(faculty.phone),
    additionalPhones: combineGroup("additionalPhones", (faculty.additionalPhoneNumbers ?? []).map((n) => [n.label ?? "", n.number ?? ""])),
    status: s(faculty.status),
    employeeCategory: faculty.employeeCategory ? (EMPLOYEE_CATEGORY_LABELS[faculty.employeeCategory] ?? s(faculty.employeeCategory)) : "",
    employmentType: s(faculty.employmentType),
    dateOfJoiningDepartment: toDateInputValue(faculty.dateOfJoiningDepartment),
    officialEmail: s(faculty.officialEmail),

    // ─── Personal Details ─────────────────────────────────────────────────
    gender: s(faculty.gender),
    dateOfBirth: toDateInputValue(faculty.dateOfBirth),
    nameAsPerAadhar: s(faculty.nameAsPerAadhar),
    fatherName: s(faculty.fatherName),
    motherName: s(faculty.motherName),
    religion: faculty.religion ? (RELIGION_LABELS[faculty.religion as Religion] ?? s(faculty.religion)) : "",
    caste: faculty.caste ? (CASTE_LABELS[faculty.caste as Caste] ?? s(faculty.caste)) : "",
    subCaste: s(faculty.subCaste),
    aadharNo: s(faculty.aadharNo),
    panNo: s(faculty.panNo),
    passportNumber: s(faculty.passportNumber),
    differentlyAbled: yesNo(faculty.differentlyAbled),
    differentlyAbledDetails: s(faculty.differentlyAbledDetails),
    motherTongue: s(faculty.motherTongue),
    languagesKnown: (faculty.languagesKnown ?? []).join(", "),
    heightFeet: s(faculty.heightFeet),
    heightInches: s(faculty.heightInches),
    weightKg: s(faculty.weightKg),
    maritalStatus: s(faculty.maritalStatus),
    spouseName: s(faculty.spouseName),
    numberOfChildren: s(faculty.numberOfChildren),
    bloodGroup: s(faculty.bloodGroup),
    temporaryAddress: s(faculty.temporaryAddress),
    permanentSameAsTemporary: yesNo(faculty.permanentSameAsTemporary),
    permanentAddress: s(faculty.permanentAddress),
    bankAccountNo: s(faculty.bankAccountNo),
    ifscCode: s(faculty.ifscCode),
    bankName: s(faculty.bankName),
    bankBranch: s(faculty.bankBranch),
    bankOtherDetails: s(faculty.bankOtherDetails),
    pfNumber: s(faculty.pfNumber),
    emergencyContactName: s(faculty.emergencyContactName),
    emergencyContactRelation: s(faculty.emergencyContactRelation),
    emergencyContactPhone: s(faculty.emergencyContactPhone),
    ratificationStatus: s(faculty.ratificationStatus),
    ratificationProceedingsNumber: s(faculty.ratificationProceedingsNumber),
    ratificationDate: toDateInputValue(faculty.ratificationDate),

    // ─── Academic Qualification ─────────────────────────────────────────────
    highestQualification: s(p.highestQualification),
    researchAreas: (p.researchAreas ?? []).join(", "),
    phdStatus: p.phdStatus ? (PHD_STATUS_LABELS[p.phdStatus] ?? p.phdStatus) : "",
    phdMode: p.phdMode ? (PHD_MODE_LABELS[p.phdMode] ?? p.phdMode) : "",
    phdSupervisorName: s(p.phdSupervisorName),
    fellowshipsReceived: s(p.fellowshipsReceived),
    qualifyingExamQualified: s(p.qualifyingExamQualified === "YES" ? "Yes" : p.qualifyingExamQualified === "NO" ? "No" : undefined),
    qualifyingExam: p.qualifyingExam ? (p.qualifyingExam === "OTHER" ? (p.otherQualifyingExam || "Other") : (QUALIFYING_EXAM_LABELS[p.qualifyingExam] ?? p.qualifyingExam)) : "",
    otherQualifyingExam: s(p.otherQualifyingExam),
    qualifyingExamScore: s(p.qualifyingExamScore),
    qualifyingExamYear: s(p.qualifyingExamYear),
    highSchoolDetails: combineGroup("highSchoolDetails", p.highSchoolDetails ? [schoolDegreeCells(p.highSchoolDetails)] : []),
    intermediateDetails: combineGroup("intermediateDetails", p.intermediateDetails ? [schoolDegreeCells(p.intermediateDetails)] : []),
    ugDetailsGroup: combineGroup("ugDetailsGroup", degreeList(p.ugDetails, p.additionalUgDetails).map(degreeCells)),
    pgDetailsGroup: combineGroup("pgDetailsGroup", degreeList(p.pgDetails, p.additionalPgDetails).map(degreeCells)),
    phdDetailsGroup: combineGroup("phdDetailsGroup", degreeList(p.phdDetails, p.additionalPhdDetails).map(phdDegreeCells)),
    postDoctoralDetailsGroup: combineGroup("postDoctoralDetailsGroup", p.postDoctoralDetails ? [degreeCells(p.postDoctoralDetails)] : []),
    schoolQualifications: combineGroup("schoolQualifications", (p.schoolQualifications ?? []).map(staffQualificationCells)),

    // ─── Professional Experience ────────────────────────────────────────────
    primaryTeachingRole: s(teaching?.primaryTeachingRole),
    primaryIndustryRole: s(p.primaryIndustryRole),
    primaryResearchRole: s(p.primaryResearchRole),
    previousInstitutionsGroup: combineGroup("previousInstitutionsGroup", (p.previousInstitutions ?? []).map(experienceCells)),
    industryExperienceGroup: combineGroup("industryExperienceGroup", (p.industryExperienceEntries ?? []).map(experienceCells)),
    researchExperienceGroup: combineGroup("researchExperienceGroup", (p.researchExperienceEntries ?? []).map(experienceCells)),
    promotionHistoryGroup: combineGroup("promotionHistoryGroup", (p.promotionHistory ?? []).map(promotionCells)),
    coursesGroup: combineGroup("coursesGroup", (teaching?.courses ?? []).map(courseCells)),

    // ─── Research & Innovation ───────────────────────────────────────────────
    publicationsFirstOrCorrespondingAuthor: s(p.publicationsFirstOrCorrespondingAuthor),
    publicationsQ1OrHighImpact: s(p.publicationsQ1OrHighImpact),
    sciScopusCount: s(p.sciScopusCount),
    wosCount: s(p.wosCount),
    conferencePapersCount: s(p.conferencePapersCount),
    bookChaptersCount: s(p.bookChaptersCount),
    reviewPublicationsCount: s(p.reviewPublicationsCount),
    totalPublications: s(p.totalPublications),
    totalCitations: s(p.totalCitations),
    hIndex: s(p.hIndex),
    i10Index: s(p.i10Index),
    orcidId: s(p.orcidId),
    scopusAuthorId: s(p.scopusAuthorId),
    researcherId: s(p.researcherId),
    googleScholarId: s(p.googleScholarId),
    irinsProfile: s(p.irinsProfile),
    publicationsGroup: combineGroup("publicationsGroup", (p.publications ?? []).map(publicationCells)),
    authoredBooksGroup: combineGroup("authoredBooksGroup", (p.authoredBooks ?? []).map(bookCells)),

    // ─── Professional Development ───────────────────────────────────────────
    labsEstablishedGroup: combineGroup("labsEstablishedGroup", (p.labsEstablished ?? []).map(labCells)),
    adminResponsibilityGroup: combineGroup("adminResponsibilityGroup", (p.adminResponsibilityEntries ?? []).map(adminRespCells)),
    trainingEntriesGroup: combineGroup("trainingEntriesGroup", (p.trainingEntries ?? []).map(trainingCells)),
    professionalMembershipsGroup: combineGroup("professionalMembershipsGroup", (p.professionalMemberships ?? []).map(membershipCells)),
    awardEntriesGroup: combineGroup("awardEntriesGroup", (p.awardEntries ?? []).map(awardCells)),

    // ─── Financial Standing ──────────────────────────────────────────────────
    presentSalary: s(p.presentSalary),
    grossAnnualCTC: s(p.grossAnnualCTC),
    incrementsAwarded: s(p.incrementsAwarded),
    fundingConsultancyRevenue: s(p.fundingConsultancyRevenue),

    // ─── Others ───────────────────────────────────────────────────────────
    otherInformation: s(p.otherInformation),

    // ─── Teaching Load ────────────────────────────────────────────────────
    currentTeachingSummary: teachingSummary,
  };

  return row;
}

export function exportFacultyCsv(
  faculty: FacultyMember[],
  teachingSummaries: Record<string, string> = {},
  // Omitted => every field flagged defaultSelected in EXPORT_FIELDS (today's
  // Identity & Employment + Personal Details set), so any other hypothetical
  // caller keeps working unchanged.
  selectedFieldKeys?: string[]
): void {
  const selected = new Set(selectedFieldKeys ?? EXPORT_FIELDS.filter((f) => f.defaultSelected).map((f) => f.key));
  const exportFields = EXPORT_FIELDS.filter((f) => selected.has(f.key));
  const headers = exportFields.map((f) => f.label);
  const rows = faculty.map((f) => {
    const row = buildRow(f, teachingSummaries[f.id] ?? "");
    return exportFields.map((c) => row[c.key] ?? "");
  });
  downloadCSV(toCSV([headers, ...rows]), `faculty_export_${toDateInputValue(new Date())}.csv`);
}
