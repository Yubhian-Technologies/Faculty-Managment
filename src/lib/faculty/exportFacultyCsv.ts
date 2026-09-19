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
  degreeYear, ADMIN_RESPONSIBILITY_CATEGORY_LABELS, TRAINING_ENTRY_TYPE_LABELS, TRAINING_PARTICIPATION_ROLE_LABELS, EMPLOYEE_CATEGORY_LABELS,
  PROFESSIONAL_BODY_LABELS, AWARD_CATEGORY_LABELS, AWARD_LEVEL_LABELS, QUALIFYING_EXAM_LABELS, RELIGION_LABELS, CASTE_LABELS,
  CERTIFICATION_TYPE_LABELS, TRAINING_PROGRAM_LEVEL_LABELS, TRAINING_PROGRAM_MODE_LABELS, MEMBERSHIP_VALIDITY_LABELS,
} from "@/types";
import type {
  FacultyMember, FacultyProfileFields, DegreeDetail, StaffQualification, CourseAssignment, Publication,
  PreviousInstitution, LabEstablished, AuthoredBook, PromotionRecord,
  AdminResponsibilityEntry, TrainingEntry, ProfessionalMembership, AwardEntry, Religion, Caste,
} from "@/types";
import { normalizeAcademicProfile } from "@/lib/faculty/academicProfileCompat";
import { migrateFacultyDoc } from "@/lib/faculty/fieldRenames";
import { allPreviousExperienceEntries, experienceBreakdown } from "@/lib/faculty/experienceCalc";
import { normalizeResourcePersonsDetails } from "@/components/faculty/TrainingEntryFields";
import { awardYear } from "@/lib/faculty/awardYear";

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

function yearCell(d: DegreeDetail, doctoral: boolean): string {
  const y = degreeYear(d, doctoral);
  return y ? String(y) : "";
}

function degreeCells(d: DegreeDetail): string[] {
  return [
    d.course ?? "", d.branch ?? "", d.institutionName ?? "", d.affiliatedUniversity ?? "",
    d.percentageCgpa ?? "", yearCell(d, false),
    d.place ?? "", d.hallTicketNumber ?? "",
  ];
}

// Doctoral/Post-Doctoral entries (Ph.D. Details, Postdoctoral Fellowship
// Details) take Specialization instead of Course/Branch/Percentage-CGPA, plus this
// entry's own Status/Mode (live on DegreeDetail.status/.mode - see
// DegreeFields in ProfileFieldPrimitives.tsx) and Year of Registration/Name
// of the Guide-Supervisor - shown instead of Year of Award while Pursuing.
function doctoralDegreeCells(d: DegreeDetail): string[] {
  return [
    d.specialization || d.branch || "", d.institutionName ?? "",
    d.status ? (PHD_STATUS_LABELS[d.status] ?? d.status) : "",
    d.mode ? (PHD_MODE_LABELS[d.mode] ?? d.mode) : "",
    d.yearOfRegistration ? String(d.yearOfRegistration) : "",
    d.nameOfTheGuideSupervisor ?? "",
    yearCell(d, true),
    d.place ?? "", d.hallTicketNumber ?? "",
  ];
}

// School-level entries (10th/12th): `course` holds the Course name,
// `institutionName` holds the School/College name (see DegreeFields
// isSchoolLevel branch in ProfileFieldPrimitives.tsx).
function schoolDegreeCells(d: DegreeDetail): string[] {
  return [
    d.course ?? "", d.board ?? "", d.institutionName ?? "", d.percentageCgpa ?? "",
    yearCell(d, false), d.place ?? "", d.hallTicketNumber ?? "",
  ];
}

// StaffQualification (School-type colleges' flat qualifications list, see
// QualificationsFields) - its own shape, no separate Board field.
function staffQualificationCells(q: StaffQualification): string[] {
  return [
    q.level ?? "", q.course ?? "", q.institutionName ?? "", q.place ?? "",
    q.percentageCgpa ?? "", yearCell(q, false), q.hallTicketNumber ?? "",
  ];
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
  const fromDate = a.fromDate ?? (a.fromYear ? String(a.fromYear) : "");
  const toDate = a.toDate ?? (a.toYear ? String(a.toYear) : "");
  return [
    ADMIN_RESPONSIBILITY_CATEGORY_LABELS[a.category] ?? a.category,
    a.category === "OTHER" ? (a.otherCategory ?? "") : "",
    a.description ?? "", fromDate, toDate,
  ];
}

// "Beneficiaries" cell: who this program served (Total/Internal/External Count
// are their own columns) - same wording as the read-only view (see
// beneficiarySummary in ProfileFieldsView.tsx).
function trainingBeneficiarySummary(t: TrainingEntry): string {
  if (t.beneficiaries === "STUDENTS") {
    const parts = (t.beneficiaryDepartments ?? []).map(
      (d) => `${d.courseName} - ${d.department} Yr ${d.year} (${d.sections.map((s) => `${s.sectionName}: ${s.count}`).join(", ")})`
    );
    return parts.length > 0 ? `Students - ${parts.join("; ")}` : "Students";
  }
  if (t.beneficiaries === "FACULTY") return "Faculty";
  return "";
}

function trainingCells(t: TrainingEntry): string[] {
  // MOOC/CERTIFICATION are measured in weeks, not a date range - see
  // TrainingEntryFields' own From/To Date vs Number of Weeks branch.
  const resourcePersons = normalizeResourcePersonsDetails(t.resourcePersonsDetails);
  const coConductingFaculty = (t.coConductingFaculty ?? []).map((c) => `${c.order}. ${c.name} (${c.department})`).join(", ");
  return [
    TRAINING_ENTRY_TYPE_LABELS[t.type] ?? t.type,
    t.type === "OTHER" ? (t.pleaseSpecifyType ?? "") : "",
    t.certificationType ? (CERTIFICATION_TYPE_LABELS[t.certificationType] ?? t.certificationType) : "",
    t.participatedOrConducted ? TRAINING_PARTICIPATION_ROLE_LABELS[t.participatedOrConducted] : "",
    t.titleOfTheProgram ?? "",
    t.nameOfTheFacultyCoordinator ?? "",
    t.fromDate ?? (t.year ? String(t.year) : ""),
    t.toDate ?? "",
    t.duration ? `${t.duration} day${t.duration === 1 ? "" : "s"}` : "",
    t.numberOfWeeks ? String(t.numberOfWeeks) : "",
    t.nationalInternational ? (TRAINING_PROGRAM_LEVEL_LABELS[t.nationalInternational] ?? t.nationalInternational) : "",
    t.place ?? "",
    t.modeOfTheProgram ? (TRAINING_PROGRAM_MODE_LABELS[t.modeOfTheProgram] ?? t.modeOfTheProgram) : "",
    trainingBeneficiarySummary(t),
    t.beneficiaries && t.totalCount !== undefined ? String(t.totalCount) : "",
    t.beneficiaries === "FACULTY" && t.internalCount !== undefined ? String(t.internalCount) : "",
    t.beneficiaries === "FACULTY" && t.externalCount !== undefined ? String(t.externalCount) : "",
    t.numberOfResourcePersons ? String(t.numberOfResourcePersons) : "",
    resourcePersons.length > 0 ? resourcePersons.map((d, i) => `${i + 1}. ${d}`).join("; ") : "",
    t.participatedOrConducted === "PARTICIPATED" ? (t.remark ?? "") : "",
    coConductingFaculty,
    t.otherDetails ?? "",
  ];
}

function membershipCells(m: ProfessionalMembership): string[] {
  const annual = m.membershipValidity === "ANNUAL";
  return [
    PROFESSIONAL_BODY_LABELS[m.body] ?? m.body,
    m.body === "OTHER" ? (m.bodyName ?? "") : "",
    m.membershipType ?? "", m.membershipId ?? "",
    m.membershipValidity ? (MEMBERSHIP_VALIDITY_LABELS[m.membershipValidity] ?? m.membershipValidity) : "",
    // Member Since (LIFETIME) - with the legacy month/year-only shapes as fallbacks.
    annual ? "" : (m.memberSince ?? (m.sinceYear ? String(m.sinceYear) : (m.sinceMonthYear ?? ""))),
    annual ? (m.validFrom ?? "") : "",
    annual ? (m.validTo ?? "") : "",
  ];
}

function awardCells(a: AwardEntry): string[] {
  // dateOfAward, falling back to the legacy year-only value on a record not re-saved yet.
  const dateOfAward = a.dateOfAward ?? (awardYear(a) ? String(awardYear(a)) : "");
  return [
    AWARD_CATEGORY_LABELS[a.category] ?? a.category,
    a.category === "OTHER" ? (a.otherCategory ?? "") : "",
    a.titleOfAward ?? "", a.awardingAgencyBody ?? "", dateOfAward,
    a.stateNationalInternational ? (AWARD_LEVEL_LABELS[a.stateNationalInternational] ?? a.stateNationalInternational) : "",
    a.otherDetails ?? "",
  ];
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

function buildRow(rawFaculty: FacultyMember, teachingSummary: string): Record<string, string> {
  // Lift legacy key names on un-migrated docs (doc-level qualification/experienceYears,
  // flat personal keys, academicProfile) - everything below reads the new names only.
  const faculty = migrateFacultyDoc(rawFaculty as unknown as Record<string, unknown>) as unknown as FacultyMember;
  const p: Partial<FacultyProfileFields> = normalizeAcademicProfile(faculty.academicProfile) ?? {};
  const teaching = p.teachingAssignment;

  // Total/Internal/External Years of Experience - computed live the same
  // canonical way as the faculty profile page (FacultyProfileHub), not read
  // from the stored (and only periodically re-saved) totalYearsOfExperience field.
  const previousExperienceEntries = allPreviousExperienceEntries(p);
  const { internal: internalExperience, external: externalExperience, total: totalExperience } =
    experienceBreakdown(previousExperienceEntries, faculty.joiningDate);

  const row: Record<string, string> = {
    // ─── Identity & Employment ───────────────────────────────────────────
    employeeId: s(faculty.employeeId),
    legalName: s(faculty.legalName),
    name: s(faculty.name),
    apaarFacultyId: s(faculty.apaarFacultyId),
    collegeEmail: s(faculty.collegeEmail),
    designation: s(faculty.designation),
    highestQualification: s(faculty.highestQualification),
    specialization: s(faculty.specialization),
    totalYearsOfExperience: s(totalExperience),
    internalExperience: faculty.joiningDate ? s(internalExperience) : "",
    externalExperience: previousExperienceEntries.length > 0 ? s(externalExperience) : "",
    joiningDate: toDateInputValue(faculty.joiningDate),
    aicteFacultyId: s(faculty.aicteFacultyId),
    email: s(faculty.email),
    phone: s(faculty.phone),
    additionalPhones: combineGroup("additionalPhones", (faculty.additionalPhoneNumbers ?? []).map((n) => [n.label ?? "", n.number ?? ""])),
    status: s(faculty.status),
    employeeCategory: faculty.employeeCategory ? (EMPLOYEE_CATEGORY_LABELS[faculty.employeeCategory] ?? s(faculty.employeeCategory)) : "",
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
    passportNo: s(faculty.passportNo),
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
    permanentAddressSameAsTemporary: yesNo(faculty.permanentAddressSameAsTemporary),
    permanentAddress: s(faculty.permanentAddress),
    bankAccountNumber: s(faculty.bankAccountNumber),
    ifscCode: s(faculty.ifscCode),
    bankName: s(faculty.bankName),
    bankBranch: s(faculty.bankBranch),
    bankOtherDetails: s(faculty.bankOtherDetails),
    pfNumber: s(faculty.pfNumber),
    uanNumber: s(faculty.uanNumber),
    emergencyContactName: s(faculty.emergencyContactName),
    emergencyContactRelation: s(faculty.emergencyContactRelation),
    emergencyContactMobileNo: s(faculty.emergencyContactMobileNo),
    ratificationStatus: s(faculty.ratificationStatus),
    ratificationProceedingsNumber: s(faculty.ratificationProceedingsNumber),
    ratificationDate: toDateInputValue(faculty.ratificationDate),

    // ─── Academic Qualification ─────────────────────────────────────────────
    academicProfileHighestQualification: s(p.highestQualification),
    researchAreasInterests: (p.researchAreasInterests ?? []).join(", "),
    netSletSetGateOthers: s(p.netSletSetGateOthers === "YES" ? "Yes" : p.netSletSetGateOthers === "NO" ? "No" : undefined),
    qualifiedExam: p.qualifiedExam ? (p.qualifiedExam === "OTHER" ? (p.pleaseSpecifyExam || "Other") : (QUALIFYING_EXAM_LABELS[p.qualifiedExam] ?? p.qualifiedExam)) : "",
    pleaseSpecifyExam: s(p.pleaseSpecifyExam),
    examScore: s(p.examScore),
    qualifiedYear: s(p.qualifiedYear),
    secondaryEducation: combineGroup("secondaryEducation", p.secondaryEducation ? [schoolDegreeCells(p.secondaryEducation)] : []),
    intermediateDiplomaIti: combineGroup("intermediateDiplomaIti", p.intermediateDiplomaIti ? [schoolDegreeCells(p.intermediateDiplomaIti)] : []),
    ugDetailsGroup: combineGroup("ugDetailsGroup", degreeList(p.ugDetails, p.additionalUgDetails).map(degreeCells)),
    pgDetailsGroup: combineGroup("pgDetailsGroup", degreeList(p.pgDetails, p.additionalPgDetails).map(degreeCells)),
    phdDetailsGroup: combineGroup("phdDetailsGroup", degreeList(p.phdDetails, p.additionalPhdDetails).map(doctoralDegreeCells)),
    postdoctoralFellowshipDetailsGroup: combineGroup("postdoctoralFellowshipDetailsGroup", p.postdoctoralFellowshipDetails ? [doctoralDegreeCells(p.postdoctoralFellowshipDetails)] : []),
    educationalQualifications: combineGroup("educationalQualifications", (p.educationalQualifications ?? []).map(staffQualificationCells)),

    // ─── Professional Experience ────────────────────────────────────────────
    teachingRolesResponsibilities: s(p.teachingRolesResponsibilities),
    industryRolesResponsibilities: s(p.industryRolesResponsibilities),
    researchRolesResponsibilities: s(p.researchRolesResponsibilities),
    academicExperienceGroup: combineGroup("academicExperienceGroup", (p.academicExperience ?? []).map(experienceCells)),
    industryExperienceGroup: combineGroup("industryExperienceGroup", (p.industryExperience ?? []).map(experienceCells)),
    researchExperienceGroup: combineGroup("researchExperienceGroup", (p.researchExperience ?? []).map(experienceCells)),
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
    newLabsEstablishedGroup: combineGroup("newLabsEstablishedGroup", (p.newLabsEstablished ?? []).map(labCells)),
    academicResponsibilitiesGroup: combineGroup("academicResponsibilitiesGroup", (p.academicResponsibilities ?? []).map(adminRespCells)),
    fdpsWorkshopsMoocsCertificationsGroup: combineGroup("fdpsWorkshopsMoocsCertificationsGroup", (p.fdpsWorkshopsMoocsCertifications ?? []).map(trainingCells)),
    professionalMembershipsGroup: combineGroup("professionalMembershipsGroup", (p.professionalMemberships ?? []).map(membershipCells)),
    awardsRecognitionGroup: combineGroup("awardsRecognitionGroup", (p.awardsRecognition ?? []).map(awardCells)),

    // ─── Financial Standing ──────────────────────────────────────────────────
    monthlySalary: s(p.monthlySalary),
    grossAnnualCTC: s(p.grossAnnualCTC),
    incrementsAwarded: s(p.incrementsAwarded),
    fundingConsultancyRevenueGeneration: s(p.fundingConsultancyRevenueGeneration),

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
