// Full-detail faculty CSV export - flattens a FacultyMember (+ academicProfile)
// into the same column set the bulk-import template accepts (src/lib/faculty/csvColumns.ts),
// so import and export stay round-trippable for every field except the
// relational "Current Teaching" summary (informational only, not re-importable).

import { toCSV, downloadCSV } from "@/lib/utils/csv";
import { toDateInputValue } from "@/lib/utils";
import { COLUMNS, TEACHING_SUMMARY_COLUMN } from "@/lib/faculty/csvColumns";
import { ADMIN_RESPONSIBILITY_CATEGORY_LABELS, TRAINING_ENTRY_TYPE_LABELS, PROFESSIONAL_BODY_LABELS, AWARD_CATEGORY_LABELS } from "@/types";
import type {
  FacultyMember, FacultyProfileFields, DegreeDetail, CourseAssignment, Publication, PreviousInstitution,
  FundedProject, ConsultancyProject, LabEstablished, AuthoredBook, PromotionRecord, AdminResponsibilityEntry,
  TrainingEntry, ProfessionalMembership, AwardEntry, CourseFileEntry,
} from "@/types";

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

function projectCells(projects: FundedProject[] | undefined, i: number): [string, string, string, string, string, string] {
  const p = projects?.[i];
  return p
    ? [p.title ?? "", p.fundingAgency ?? "", p.grantAmountLakhs ? String(p.grantAmountLakhs) : "", p.year ? String(p.year) : "", p.status ?? "", p.piOrCoPi === "CO_PI" ? "Co-PI" : p.piOrCoPi === "PI" ? "PI" : ""]
    : ["", "", "", "", "", ""];
}

function promotionCells(items: PromotionRecord[] | undefined, i: number): [string, string, string] {
  const p = items?.[i];
  return p ? [p.fromDesignation ?? "", p.toDesignation ?? "", p.effectiveYear ? String(p.effectiveYear) : ""] : ["", "", ""];
}

function adminRespCells(items: AdminResponsibilityEntry[] | undefined, i: number): [string, string, string, string] {
  const a = items?.[i];
  return a
    ? [ADMIN_RESPONSIBILITY_CATEGORY_LABELS[a.category] ?? a.category, a.description ?? "", a.fromYear ? String(a.fromYear) : "", a.toYear ? String(a.toYear) : ""]
    : ["", "", "", ""];
}

function trainingCells(items: TrainingEntry[] | undefined, i: number): [string, string, string, string, string] {
  const t = items?.[i];
  return t
    ? [TRAINING_ENTRY_TYPE_LABELS[t.type] ?? t.type, t.title ?? "", t.organizer ?? "", t.year ? String(t.year) : "", t.durationDays ? String(t.durationDays) : ""]
    : ["", "", "", "", ""];
}

function membershipCells(items: ProfessionalMembership[] | undefined, i: number): [string, string, string, string] {
  const m = items?.[i];
  return m
    ? [PROFESSIONAL_BODY_LABELS[m.body] ?? m.body, m.otherName ?? "", m.membershipId ?? "", m.sinceYear ? String(m.sinceYear) : ""]
    : ["", "", "", ""];
}

function awardCells(items: AwardEntry[] | undefined, i: number): [string, string, string, string] {
  const a = items?.[i];
  return a
    ? [AWARD_CATEGORY_LABELS[a.category] ?? a.category, a.title ?? "", a.awardingBody ?? "", a.year ? String(a.year) : ""]
    : ["", "", "", ""];
}

function courseFileCells(items: CourseFileEntry[] | undefined, i: number): [string, string, string] {
  const c = items?.[i];
  return c ? [c.courseCode ?? "", c.courseName ?? "", c.academicYear ?? ""] : ["", "", ""];
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

function buildRow(faculty: FacultyMember, teachingSummary: string): Record<string, string> {
  const p: Partial<FacultyProfileFields> = faculty.academicProfile ?? {};
  const [ugDegree, ugUniv, ugPct, ugYear] = degreeCells(p.ugDetails);
  const [pgDegree, pgUniv, pgPct, pgYear] = degreeCells(p.pgDetails);
  const [phdDegree, phdUniv, phdPct, phdYear] = degreeCells(p.phdDetails);
  const [postdocDegree, postdocUniv, postdocPct, postdocYear] = degreeCells(p.postDoctoralDetails);

  const row: Record<string, string> = {
    employeeId: s(faculty.employeeId),
    name: s(faculty.name),
    apaarFacultyId: s(faculty.apaarFacultyId),
    email: s(faculty.email),
    phone: s(faculty.phone),
    designation: s(faculty.designation),
    qualification: s(faculty.qualification),
    specialization: s(faculty.specialization),
    employmentType: s(faculty.employmentType),
    status: s(faculty.status),
    joiningDate: toDateInputValue(faculty.joiningDate),
    dateOfJoiningDepartment: toDateInputValue(faculty.dateOfJoiningDepartment),
    aicteEligible: yesNo(faculty.aicteEligible),
    experienceYears: s(faculty.experienceYears),
    internalExperience: s(faculty.internalExperience),
    externalExperience: s(faculty.externalExperience),
    inCampusExperience: s(faculty.inCampusExperience),
    industryExperience: s(faculty.industryExperience),
    researchExperience: s(faculty.researchExperience),
    gender: s(faculty.gender),
    dateOfBirth: toDateInputValue(faculty.dateOfBirth),
    legalName: s(faculty.legalName),
    fatherName: s(faculty.fatherName),
    motherName: s(faculty.motherName),
    aadharNo: s(faculty.aadharNo),
    panNo: s(faculty.panNo),
    passportNumber: s(faculty.passportNumber),
    emergencyContactName: s(faculty.emergencyContactName),
    emergencyContactPhone: s(faculty.emergencyContactPhone),
    religion: s(faculty.religion),
    caste: s(faculty.caste),
    collegeEmail: s(faculty.collegeEmail),
    ratificationStatus: s(faculty.ratificationStatus),
    ratificationDate: toDateInputValue(faculty.ratificationDate),
    hasPHD: yesNo(faculty.hasPHD),

    maritalStatus: s(faculty.maritalStatus),
    spouseName: s(faculty.spouseName),
    numberOfChildren: s(faculty.numberOfChildren),
    referral: s(faculty.referral),
    nativePlace: s(faculty.nativePlace),
    bloodGroup: s(faculty.bloodGroup),
    temporaryAddress: s(faculty.temporaryAddress),
    permanentSameAsTemporary: yesNo(faculty.permanentSameAsTemporary),
    permanentAddress: s(faculty.permanentAddress),
    resumeUrl: s(faculty.resumeUrl),

    highestQualification: s(p.highestQualification),
    ug_degreeAndBranch: ugDegree, ug_university: ugUniv, ug_percentage: ugPct, ug_year: ugYear,
    pg_degreeAndBranch: pgDegree, pg_university: pgUniv, pg_percentage: pgPct, pg_year: pgYear,
    phd_degreeAndBranch: phdDegree, phd_university: phdUniv, phd_percentage: phdPct, phd_year: phdYear,
    postdoc_degreeAndBranch: postdocDegree, postdoc_university: postdocUniv, postdoc_percentage: postdocPct, postdoc_year: postdocYear,
    phdStatus: s(p.phdStatus),
    phdMode: s(p.phdMode),
    phdSupervisorName: s(p.phdSupervisorName),
    fellowshipsReceived: s(p.fellowshipsReceived),
    gateQualifiedYear: s(p.gateQualifiedYear),
    gateScore: s(p.gateScore),
    netSletQualificationYear: s(p.netSletQualificationYear),
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
    googleScholarId: s(p.googleScholarId),
    scopusAuthorId: s(p.scopusAuthorId),
    orcidId: s(p.orcidId),

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
    presentSalary: s(p.presentSalary),
    grossAnnualCTC: s(p.grossAnnualCTC),
    incrementsAwarded: s(p.incrementsAwarded),
    fundingConsultancyRevenue: s(p.fundingConsultancyRevenue),
    otherInformation: s(p.otherInformation),

    currentTeachingSummary: teachingSummary,
  };

  [1, 2, 3].forEach((n) => {
    const [code, name, hours] = courseCells(p.teachingAssignment?.courses, n - 1);
    row[`course${n}_code`] = code; row[`course${n}_name`] = name; row[`course${n}_hours`] = hours;

    const [prevName, prevDesignation, prevYears] = previousInstitutionCells(p.previousInstitutions, n - 1);
    row[`previousInstitution${n}_name`] = prevName; row[`previousInstitution${n}_designation`] = prevDesignation; row[`previousInstitution${n}_years`] = prevYears;

    const [pubTitle, pubCoAuthors, pubJournal, pubYear, pubIndexing] = publicationCells(p.publications, n - 1);
    row[`publication${n}_title`] = pubTitle; row[`publication${n}_coAuthors`] = pubCoAuthors; row[`publication${n}_journal`] = pubJournal;
    row[`publication${n}_year`] = pubYear; row[`publication${n}_indexing`] = pubIndexing;

    const [pTitle, pAgency, pAmount, pYear, pStatus, pRole] = projectCells(p.fundedProjects, n - 1);
    row[`project${n}_title`] = pTitle; row[`project${n}_agency`] = pAgency; row[`project${n}_amount`] = pAmount;
    row[`project${n}_year`] = pYear; row[`project${n}_status`] = pStatus; row[`project${n}_role`] = pRole;

    const [cTitle, cClient, cRevenue, cYear, cStatus] = consultancyCells(p.consultancyProjects, n - 1);
    row[`consultancy${n}_title`] = cTitle; row[`consultancy${n}_client`] = cClient; row[`consultancy${n}_revenue`] = cRevenue;
    row[`consultancy${n}_year`] = cYear; row[`consultancy${n}_status`] = cStatus;

    const [labDetails, labOutcomes] = labCells(p.labsEstablished, n - 1);
    row[`lab${n}_details`] = labDetails; row[`lab${n}_outcomes`] = labOutcomes;

    const [promoFrom, promoTo, promoYear] = promotionCells(p.promotionHistory, n - 1);
    row[`promotion${n}_fromDesignation`] = promoFrom; row[`promotion${n}_toDesignation`] = promoTo; row[`promotion${n}_effectiveYear`] = promoYear;

    const [arCategory, arDescription, arFromYear, arToYear] = adminRespCells(p.adminResponsibilityEntries, n - 1);
    row[`adminResp${n}_category`] = arCategory; row[`adminResp${n}_description`] = arDescription;
    row[`adminResp${n}_fromYear`] = arFromYear; row[`adminResp${n}_toYear`] = arToYear;

    const [trType, trTitle, trOrganizer, trYear, trDuration] = trainingCells(p.trainingEntries, n - 1);
    row[`training${n}_type`] = trType; row[`training${n}_title`] = trTitle; row[`training${n}_organizer`] = trOrganizer;
    row[`training${n}_year`] = trYear; row[`training${n}_durationDays`] = trDuration;

    const [memBody, memOtherName, memId, memSinceYear] = membershipCells(p.professionalMemberships, n - 1);
    row[`membership${n}_body`] = memBody; row[`membership${n}_otherName`] = memOtherName;
    row[`membership${n}_membershipId`] = memId; row[`membership${n}_sinceYear`] = memSinceYear;

    const [bookTitle, bookPublisher, bookYear] = bookCells(p.authoredBooks, n - 1);
    row[`book${n}_title`] = bookTitle; row[`book${n}_publisher`] = bookPublisher; row[`book${n}_year`] = bookYear;

    const [awCategory, awTitle, awBody, awYear] = awardCells(p.awardEntries, n - 1);
    row[`award${n}_category`] = awCategory; row[`award${n}_title`] = awTitle;
    row[`award${n}_awardingBody`] = awBody; row[`award${n}_year`] = awYear;

    const [cfCode, cfName, cfYear] = courseFileCells(p.courseFilesAndCoPoMapping, n - 1);
    row[`courseFile${n}_courseCode`] = cfCode; row[`courseFile${n}_courseName`] = cfName; row[`courseFile${n}_academicYear`] = cfYear;
  });

  return row;
}

export function exportFacultyCsv(
  faculty: FacultyMember[],
  teachingSummaries: Record<string, string> = {}
): void {
  const exportColumns = [...COLUMNS, TEACHING_SUMMARY_COLUMN];
  const headers = exportColumns.map((c) => c.label);
  const rows = faculty.map((f) => {
    const row = buildRow(f, teachingSummaries[f.id] ?? "");
    return exportColumns.map((c) => row[c.key] ?? "");
  });
  downloadCSV(toCSV([headers, ...rows]), `faculty_export_${toDateInputValue(new Date())}.csv`);
}
