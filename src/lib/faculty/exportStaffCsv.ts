// Full-detail staff (FMSUser) CSV export - flattens a staff member (+ academicProfile)
// into the column set defined in src/lib/faculty/staffCsvColumns.ts, so Principal's
// "Export All Details" covers every field shown on the staff edit page.

import { toCSV, downloadCSV } from "@/lib/utils/csv";
import { toDateInputValue } from "@/lib/utils";
import { STAFF_COLUMNS } from "@/lib/faculty/staffCsvColumns";
import { normalizeAcademicProfile } from "@/lib/faculty/academicProfileCompat";
import { migrateUserDoc } from "@/lib/faculty/fieldRenames";
import { ROLE_LABELS, RELIGION_LABELS, CASTE_LABELS, degreeYear } from "@/types";
import type { FMSUser, FacultyProfileFields, DegreeDetail, CourseAssignment, Publication, PreviousInstitution, LabEstablished, AuthoredBook, Religion, Caste } from "@/types";

function s(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

function yesNo(v: boolean | undefined): string {
  return v === undefined ? "" : v ? "Yes" : "No";
}

function degreeCells(d: DegreeDetail | undefined): [string, string, string, string] {
  if (!d) return ["", "", "", ""];
  const courseAndBranch = [d.course, d.branch].filter(Boolean).join(" ");
  const year = degreeYear(d, false);
  return [courseAndBranch, d.institutionName ?? "", d.percentageCgpa ?? "", year ? String(year) : ""];
}

// PhD entries take Specialization instead of Course/Branch/Percentage-CGPA (see
// DegreeFields in ProfileFieldPrimitives.tsx) and use Year of Award.
function phdDegreeCells(d: DegreeDetail | undefined): [string, string, string] {
  if (!d) return ["", "", ""];
  const year = degreeYear(d, true);
  return [d.specialization ?? "", d.institutionName ?? "", year ? String(year) : ""];
}

function courseCells(courses: CourseAssignment[] | undefined, i: number): [string, string, string] {
  const c = courses?.[i];
  return c ? [c.code ?? "", c.name ?? "", c.weeklyCreditHours ? String(c.weeklyCreditHours) : ""] : ["", "", ""];
}

function academicExperienceCells(items: PreviousInstitution[] | undefined, i: number): [string, string, string, string] {
  const p = items?.[i];
  if (!p) return ["", "", "", ""];
  // Prefers the real dates; falls back to the legacy year-only value for a
  // record that hasn't been re-saved under the new shape yet.
  const from = p.fromDate ?? (p.fromYear ? String(p.fromYear) : "");
  const to = p.toDate ?? (p.toYear ? String(p.toYear) : "");
  return [p.institutionName ?? "", p.designation ?? "", from, to];
}

function publicationCells(items: Publication[] | undefined, i: number): [string, string, string, string, string] {
  const p = items?.[i];
  return p
    ? [p.title ?? "", p.coAuthors ?? "", p.journalOrConference ?? "", p.publicationYear ? String(p.publicationYear) : "", p.indexing ?? ""]
    : ["", "", "", "", ""];
}

function labCells(labs: LabEstablished[] | undefined, i: number): [string, string] {
  const l = labs?.[i];
  return l ? [l.facilityDetails ?? "", l.outcomes ?? ""] : ["", ""];
}

function bookCells(books: AuthoredBook[] | undefined, i: number): [string, string, string] {
  const b = books?.[i];
  return b ? [b.title ?? "", b.publisher ?? "", b.year ? String(b.year) : ""] : ["", "", ""];
}

function buildRow(rawUser: FMSUser): Record<string, string> {
  // Lift legacy key names on un-migrated docs (flat personal keys, academicProfile).
  const user = migrateUserDoc(rawUser as unknown as Record<string, unknown>) as unknown as FMSUser;
  const p: Partial<FacultyProfileFields> = normalizeAcademicProfile(user.academicProfile) ?? {};
  const [ugDegree, ugUniv, ugPct, ugYear] = degreeCells(p.ugDetails);
  const [pgDegree, pgUniv, pgPct, pgYear] = degreeCells(p.pgDetails);
  const [phdSpecialization, phdUniv, phdYear] = phdDegreeCells(p.phdDetails);

  const row: Record<string, string> = {
    role: ROLE_LABELS[user.role] ?? s(user.role),
    name: s(user.name),
    email: s(user.email),
    collegeEmail: s(user.collegeEmail),
    phone: s(user.phone),
    employeeId: s(user.employeeId),
    designation: s(user.designation),
    department: s(user.department),
    dateOfBirth: toDateInputValue(user.dateOfBirth),
    isActive: yesNo(user.isActive),
    gender: s(user.gender),
    legalName: s(user.legalName),
    fatherName: s(user.fatherName),
    motherName: s(user.motherName),
    religion: user.religion ? (RELIGION_LABELS[user.religion as Religion] ?? s(user.religion)) : "",
    caste: user.caste ? (CASTE_LABELS[user.caste as Caste] ?? s(user.caste)) : "",
    subCaste: s(user.subCaste),
    aadharNo: s(user.aadharNo),
    panNo: s(user.panNo),
    passportNo: s(user.passportNo),
    bankAccountNumber: s(user.bankAccountNumber),
    ifscCode: s(user.ifscCode),
    bankName: s(user.bankName),
    bankBranch: s(user.bankBranch),
    bankOtherDetails: s(user.bankOtherDetails),
    emergencyContactName: s(user.emergencyContactName),
    emergencyContactRelation: s(user.emergencyContactRelation),
    emergencyContactMobileNo: s(user.emergencyContactMobileNo),
    ratificationStatus: s(user.ratificationStatus),
    ratificationProceedingsNumber: s(user.ratificationProceedingsNumber),
    ratificationDate: toDateInputValue(user.ratificationDate),

    maritalStatus: s(user.maritalStatus),
    spouseName: s(user.spouseName),
    numberOfChildren: s(user.numberOfChildren),
    bloodGroup: s(user.bloodGroup),
    temporaryAddress: s(user.temporaryAddress),
    permanentAddressSameAsTemporary: yesNo(user.permanentAddressSameAsTemporary),
    permanentAddress: s(user.permanentAddress),

    highestQualification: s(p.highestQualification),
    ug_degreeAndBranch: ugDegree, ug_university: ugUniv, ug_percentage: ugPct, ug_year: ugYear,
    pg_degreeAndBranch: pgDegree, pg_university: pgUniv, pg_percentage: pgPct, pg_year: pgYear,
    phd_specialization: phdSpecialization, phd_university: phdUniv, phd_year: phdYear,
    netSletSetGateOthers: s(p.netSletSetGateOthers === "YES" ? "Yes" : p.netSletSetGateOthers === "NO" ? "No" : undefined),
    qualifiedExam: s(p.qualifiedExam),
    examScore: s(p.examScore),
    qualifiedYear: s(p.qualifiedYear),
    teachingRolesResponsibilities: s(p.teachingRolesResponsibilities),
    industryRolesResponsibilities: s(p.industryRolesResponsibilities),
    researchRolesResponsibilities: s(p.researchRolesResponsibilities),

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

  };

  [1, 2, 3].forEach((n) => {
    const [code, name, hours] = courseCells(p.teachingAssignment?.courses, n - 1);
    row[`course${n}_code`] = code; row[`course${n}_name`] = name; row[`course${n}_hours`] = hours;

    const [expName, expDesignation, expFrom, expTo] = academicExperienceCells(p.academicExperience, n - 1);
    row[`academicExperience${n}_institutionName`] = expName; row[`academicExperience${n}_designation`] = expDesignation;
    row[`academicExperience${n}_fromDate`] = expFrom; row[`academicExperience${n}_toDate`] = expTo;

    const [pubTitle, pubCoAuthors, pubJournal, pubYear, pubIndexing] = publicationCells(p.publications, n - 1);
    row[`publication${n}_title`] = pubTitle; row[`publication${n}_coAuthors`] = pubCoAuthors; row[`publication${n}_journal`] = pubJournal;
    row[`publication${n}_year`] = pubYear; row[`publication${n}_indexing`] = pubIndexing;

    const [labDetails, labOutcomes] = labCells(p.newLabsEstablished, n - 1);
    row[`lab${n}_details`] = labDetails; row[`lab${n}_outcomes`] = labOutcomes;

    const [bookTitle, bookPublisher, bookYear] = bookCells(p.authoredBooks, n - 1);
    row[`book${n}_title`] = bookTitle; row[`book${n}_publisher`] = bookPublisher; row[`book${n}_year`] = bookYear;
  });

  return row;
}

export function exportStaffCsv(users: FMSUser[]): void {
  const headers = STAFF_COLUMNS.map((c) => c.label);
  const rows = users.map((u) => {
    const row = buildRow(u);
    return STAFF_COLUMNS.map((c) => row[c.key] ?? "");
  });
  downloadCSV(toCSV([headers, ...rows]), `staff_export_${toDateInputValue(new Date())}.csv`);
}
