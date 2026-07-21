// Full-detail staff (FMSUser) CSV export — flattens a staff member (+ academicProfile)
// into the column set defined in src/lib/faculty/staffCsvColumns.ts, so Principal's
// "Export All Details" covers every field shown on the staff edit page.

import { toCSV, downloadCSV } from "@/lib/utils/csv";
import { toDateInputValue } from "@/lib/utils";
import { STAFF_COLUMNS } from "@/lib/faculty/staffCsvColumns";
import { ROLE_LABELS } from "@/types";
import type { FMSUser, FacultyProfileFields, DegreeDetail, CourseAssignment, Publication, PreviousInstitution, FundedProject, ConsultancyProject, LabEstablished, AuthoredBook } from "@/types";

function s(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

function yesNo(v: boolean | undefined): string {
  return v === undefined ? "" : v ? "Yes" : "No";
}

function degreeCells(d: DegreeDetail | undefined): [string, string, string, string] {
  if (!d) return ["", "", "", ""];
  return [d.degreeAndBranch ?? "", d.universityOrInstitute ?? "", d.percentageOrDivision ?? "", d.yearOfCompletion ? String(d.yearOfCompletion) : ""];
}

function courseCells(courses: CourseAssignment[] | undefined, i: number): [string, string, string] {
  const c = courses?.[i];
  return c ? [c.code ?? "", c.name ?? "", c.weeklyCreditHours ? String(c.weeklyCreditHours) : ""] : ["", "", ""];
}

function previousInstitutionCells(items: PreviousInstitution[] | undefined, i: number): [string, string, string] {
  const p = items?.[i];
  return p ? [p.institutionName ?? "", p.designation ?? "", p.yearsWorked ? String(p.yearsWorked) : ""] : ["", "", ""];
}

function publicationCells(items: Publication[] | undefined, i: number): [string, string, string, string, string] {
  const p = items?.[i];
  return p
    ? [p.title ?? "", p.coAuthors ?? "", p.journalOrConference ?? "", p.publicationYear ? String(p.publicationYear) : "", p.indexing ?? ""]
    : ["", "", "", "", ""];
}

function projectCells(projects: FundedProject[] | undefined, i: number): [string, string, string, string, string] {
  const p = projects?.[i];
  return p
    ? [p.title ?? "", p.fundingAgency ?? "", p.grantAmountLakhs ? String(p.grantAmountLakhs) : "", p.year ? String(p.year) : "", p.status ?? ""]
    : ["", "", "", "", ""];
}

function consultancyCells(items: ConsultancyProject[] | undefined, i: number): [string, string, string, string, string] {
  const c = items?.[i];
  return c
    ? [c.title ?? "", c.clientOrAgency ?? "", c.revenueLakhs ? String(c.revenueLakhs) : "", c.year ? String(c.year) : "", c.status ?? ""]
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

function buildRow(user: FMSUser): Record<string, string> {
  const p: Partial<FacultyProfileFields> = user.academicProfile ?? {};
  const [ugDegree, ugUniv, ugPct, ugYear] = degreeCells(p.ugDetails);
  const [pgDegree, pgUniv, pgPct, pgYear] = degreeCells(p.pgDetails);
  const [phdDegree, phdUniv, phdPct, phdYear] = degreeCells(p.phdDetails);

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
    religion: s(user.religion),
    caste: s(user.caste),
    aadharNo: s(user.aadharNo),
    panNo: s(user.panNo),
    passportNumber: s(user.passportNumber),
    emergencyContactName: s(user.emergencyContactName),
    emergencyContactPhone: s(user.emergencyContactPhone),
    ratificationStatus: s(user.ratificationStatus),
    ratificationDate: toDateInputValue(user.ratificationDate),

    maritalStatus: s(user.maritalStatus),
    spouseName: s(user.spouseName),
    numberOfChildren: s(user.numberOfChildren),
    referral: s(user.referral),
    nativePlace: s(user.nativePlace),
    bloodGroup: s(user.bloodGroup),
    temporaryAddress: s(user.temporaryAddress),
    permanentSameAsTemporary: yesNo(user.permanentSameAsTemporary),
    permanentAddress: s(user.permanentAddress),

    highestQualification: s(p.highestQualification),
    ug_degreeAndBranch: ugDegree, ug_university: ugUniv, ug_percentage: ugPct, ug_year: ugYear,
    pg_degreeAndBranch: pgDegree, pg_university: pgUniv, pg_percentage: pgPct, pg_year: pgYear,
    phd_degreeAndBranch: phdDegree, phd_university: phdUniv, phd_percentage: phdPct, phd_year: phdYear,
    phdStatus: s(p.phdStatus),
    phdMode: s(p.phdMode),
    phdSupervisorName: s(p.phdSupervisorName),
    fellowshipsReceived: s(p.fellowshipsReceived),
    gateQualifiedYear: s(p.gateQualifiedYear),
    gateScore: s(p.gateScore),
    netSletQualificationYear: s(p.netSletQualificationYear),
    teachingExperienceBeforeJoiningYears: s(p.teachingExperienceBeforeJoiningYears),
    teachingExperienceSinceJoiningYears: s(p.teachingExperienceSinceJoiningYears),
    researchOrIndustryExperienceYears: s(p.researchOrIndustryExperienceYears),
    totalProfessionalExperienceYears: s(p.totalProfessionalExperienceYears),
    totalWeeklyTeachingLoadHours: s(p.totalWeeklyTeachingLoadHours),
    averageStudentFeedbackScore: s(p.averageStudentFeedbackScore),
    primaryTeachingRole: s(p.teachingAssignment?.primaryTeachingRole),

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

    patentIndianFiled: s(p.patents?.indianFiled),
    patentIndianPublished: s(p.patents?.indianPublished),
    patentIndianGranted: s(p.patents?.indianGranted),
    patentInternationalFiled: s(p.patents?.internationalFiled),
    patentInternationalPublished: s(p.patents?.internationalPublished),
    patentInternationalGranted: s(p.patents?.internationalGranted),
    patentDetails: s(p.patents?.details),

    phdScholarsPursuingCount: s(p.phdScholarsPursuing?.count),
    phdScholarsPursuingUniversities: s(p.phdScholarsPursuing?.universities),
    phdScholarsAwardedCount: s(p.phdScholarsAwarded?.count),
    phdScholarsAwardedUniversities: s(p.phdScholarsAwarded?.universities),
    nationalExposure: s(p.nationalExposure),
    internationalExposure: s(p.internationalExposure),
    administrativeResponsibilities: s(p.administrativeResponsibilities),
    certificationsAndFdps: s(p.certificationsAndFdps),
    professionalBodyMemberships: s(p.professionalBodyMemberships),
    notableAwards: s(p.notableAwards),
  };

  [1, 2, 3].forEach((n) => {
    const [code, name, hours] = courseCells(p.teachingAssignment?.courses, n - 1);
    row[`course${n}_code`] = code; row[`course${n}_name`] = name; row[`course${n}_hours`] = hours;

    const [prevName, prevDesignation, prevYears] = previousInstitutionCells(p.previousInstitutions, n - 1);
    row[`previousInstitution${n}_name`] = prevName; row[`previousInstitution${n}_designation`] = prevDesignation; row[`previousInstitution${n}_years`] = prevYears;

    const [pubTitle, pubCoAuthors, pubJournal, pubYear, pubIndexing] = publicationCells(p.publications, n - 1);
    row[`publication${n}_title`] = pubTitle; row[`publication${n}_coAuthors`] = pubCoAuthors; row[`publication${n}_journal`] = pubJournal;
    row[`publication${n}_year`] = pubYear; row[`publication${n}_indexing`] = pubIndexing;

    const [pTitle, pAgency, pAmount, pYear, pStatus] = projectCells(p.fundedProjects, n - 1);
    row[`project${n}_title`] = pTitle; row[`project${n}_agency`] = pAgency; row[`project${n}_amount`] = pAmount;
    row[`project${n}_year`] = pYear; row[`project${n}_status`] = pStatus;

    const [cTitle, cClient, cRevenue, cYear, cStatus] = consultancyCells(p.consultancyProjects, n - 1);
    row[`consultancy${n}_title`] = cTitle; row[`consultancy${n}_client`] = cClient; row[`consultancy${n}_revenue`] = cRevenue;
    row[`consultancy${n}_year`] = cYear; row[`consultancy${n}_status`] = cStatus;

    const [labDetails, labOutcomes] = labCells(p.labsEstablished, n - 1);
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
