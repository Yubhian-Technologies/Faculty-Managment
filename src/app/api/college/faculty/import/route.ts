export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import type {
  Designation, EmploymentType, FacultyStatus, DegreeDetail, CourseAssignment, Publication, PreviousInstitution,
  FundedProject, ConsultancyProject, LabEstablished, AuthoredBook, PromotionRecord, AdminResponsibilityEntry,
  AdminResponsibilityCategory, TrainingEntry, TrainingEntryType, ProfessionalMembership, ProfessionalBody,
  AwardEntry, AwardCategory, CourseFileEntry,
} from "@/types";

const DESIGNATION_MAP: Record<string, Designation> = {
  "professor": "PROFESSOR",
  "prof.": "PROFESSOR",
  "associate professor": "ASSOCIATE_PROFESSOR",
  "assoc. prof.": "ASSOCIATE_PROFESSOR",
  "assoc.prof.": "ASSOCIATE_PROFESSOR",
  "assistant professor": "ASSISTANT_PROFESSOR",
  "asst. prof.": "ASSISTANT_PROFESSOR",
  "asst.prof.": "ASSISTANT_PROFESSOR",
  "asst prof": "ASSISTANT_PROFESSOR",
  "lecturer": "LECTURER",
  "visiting faculty": "VISITING_FACULTY",
  "adjunct faculty": "ADJUNCT_FACULTY",
  "lab assistant": "LAB_ASSISTANT",
  "programmer": "PROGRAMMER",
  "system administrator": "SYSTEM_ADMINISTRATOR",
  "sysadmin": "SYSTEM_ADMINISTRATOR",
  "network engineer": "NETWORK_ENGINEER",
  "other": "OTHER",
};

const EMPLOYMENT_MAP: Record<string, EmploymentType> = {
  "regular": "PERMANENT",
  "permanent": "PERMANENT",
  "contract": "CONTRACT",
  "visiting": "VISITING",
  "part-time": "PART_TIME",
  "part time": "PART_TIME",
  "regular(phy)": "PERMANENT",
  "dummy": "CONTRACT",
};

const STATUS_MAP: Record<string, FacultyStatus> = {
  "active": "ACTIVE",
  "on leave": "ON_LEAVE",
  "resigned": "RESIGNED",
  "retired": "RETIRED",
};

const PI_CO_PI_MAP: Record<string, "PI" | "CO_PI"> = {
  "pi": "PI",
  "co-pi": "CO_PI",
  "co pi": "CO_PI",
  "copi": "CO_PI",
};

const ADMIN_RESPONSIBILITY_CATEGORY_MAP: Record<string, AdminResponsibilityCategory> = {
  "coordinator role": "COORDINATOR",
  "coordinator": "COORDINATOR",
  "committee membership": "COMMITTEE_MEMBER",
  "committee member": "COMMITTEE_MEMBER",
  "nba / naac work": "NBA_NAAC",
  "nba/naac work": "NBA_NAAC",
  "nba naac": "NBA_NAAC",
  "nba": "NBA_NAAC",
  "naac": "NBA_NAAC",
  "iqac": "IQAC",
  "examination duty": "EXAMINATION_DUTY",
  "other": "OTHER",
};

const TRAINING_TYPE_MAP: Record<string, TrainingEntryType> = {
  "fdp": "FDP",
  "workshop": "WORKSHOP",
  "mooc": "MOOC",
  "certification": "CERTIFICATION",
  "skill development": "SKILL_DEVELOPMENT",
  "administrative": "ADMINISTRATIVE",
  "administrative training": "ADMINISTRATIVE",
  "erp": "ERP",
  "erp training": "ERP",
  "office automation": "OFFICE_AUTOMATION",
  "office automation training": "OFFICE_AUTOMATION",
  "other": "OTHER",
};

const PROFESSIONAL_BODY_MAP: Record<string, ProfessionalBody> = {
  "ieee": "IEEE",
  "iste": "ISTE",
  "csi": "CSI",
  "acm": "ACM",
  "iei": "IEI",
  "other": "OTHER",
};

const AWARD_CATEGORY_MAP: Record<string, AwardCategory> = {
  "best teacher award": "BEST_TEACHER",
  "best teacher": "BEST_TEACHER",
  "research award": "RESEARCH_AWARD",
  "appreciation certificate": "APPRECIATION_CERTIFICATE",
  "appreciation": "APPRECIATION_CERTIFICATE",
  "other": "OTHER",
};

type ImportRow = {
  employeeId: string;
  name: string;
  email: string;
  password?: string;
  phone?: string;
  designation: string;
  qualification: string;
  specialization?: string;
  employmentType: string;
  joiningDate: string;
  dateOfBirth?: string;
  gender?: string;
  fatherName?: string;
  motherName?: string;
  aadharNo?: string;
  panNo?: string;
  passportNumber?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  religion?: string;
  caste?: string;
  legalName?: string;
  collegeEmail?: string;
  ratificationStatus?: string;
  ratificationDate?: string;
  hasPHD?: string;
  experienceYears?: string;
  internalExperience?: string;
  externalExperience?: string;
  inCampusExperience?: string;
  industryExperience?: string;
  researchExperience?: string;
  status?: string;
  maritalStatus?: string;
  spouseName?: string;
  numberOfChildren?: string;
  referral?: string;
  nativePlace?: string;
  temporaryAddress?: string;
  permanentSameAsTemporary?: string;
  permanentAddress?: string;
  bloodGroup?: string;
  // Academic Profile (Modules 1-5) - flattened columns, all optional
  [key: string]: string | undefined;
};

function num(v: string | undefined): number | undefined {
  if (!v?.trim()) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Firestore rejects `undefined` inside array elements (unlike top-level
// document fields, which the payload-building code strips manually below) -
// so any repeating-group entry with an optional numeric/string field left
// blank (e.g. an Admin Responsibility with no "To Year" because it's
// ongoing) must have that field removed here, not just left `undefined`, or
// batch.set() throws and fails the entire import.
function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

// Accepts the template's YYYY-MM-DD format, and falls back to DD-MM-YYYY /
// DD/MM/YYYY (what Excel re-saves a date cell as under an Indian locale, even
// when the column was originally filled in as YYYY-MM-DD) - otherwise a
// malformed string silently becomes a JS "Invalid Date" object that isn't
// caught by any `undefined` check and throws when Firestore serializes it,
// failing the entire batch instead of just this row.
//
// The final generic-parse fallback is dangerously lenient: V8 happily accepts
// e.g. a typo'd 5-digit-year "20110-04-15" as a *valid* Date (year 20110)
// rather than rejecting it, since it's not NaN - but that's far outside
// Firestore Timestamp's max (year 9999), and blows up batch.commit() for the
// whole import. sane() rejects anything outside a plausible human-date range.
function sane(d: Date): Date | undefined {
  const year = d.getFullYear();
  return Number.isFinite(d.getTime()) && year >= 1900 && year <= 2100 ? d : undefined;
}

function parseDate(v: string | undefined): Date | undefined {
  const trimmed = v?.trim();
  if (!trimmed) return undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    return sane(new Date(`${trimmed}T00:00:00`));
  }
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    // Guard against JS's silent day/month rollover (e.g. Feb 30 -> Mar 2).
    return d.getMonth() === Number(mm) - 1 && d.getDate() === Number(dd) ? sane(d) : undefined;
  }
  return sane(new Date(trimmed));
}

function degree(row: ImportRow, prefix: string): DegreeDetail | undefined {
  const degreeAndBranch = row[`${prefix}_degreeAndBranch`]?.trim();
  const universityOrInstitute = row[`${prefix}_university`]?.trim();
  const percentageOrDivision = row[`${prefix}_percentage`]?.trim();
  const yearOfCompletion = num(row[`${prefix}_year`]);
  if (!degreeAndBranch && !universityOrInstitute && !percentageOrDivision && !yearOfCompletion) return undefined;
  return { degreeAndBranch: degreeAndBranch ?? "", universityOrInstitute: universityOrInstitute ?? "", percentageOrDivision: percentageOrDivision ?? "", yearOfCompletion: yearOfCompletion ?? 0 };
}

function courses(row: ImportRow): CourseAssignment[] {
  return [1, 2, 3]
    .map((i) => ({ code: row[`course${i}_code`]?.trim() ?? "", name: row[`course${i}_name`]?.trim() ?? "", weeklyCreditHours: num(row[`course${i}_hours`]) ?? 0 }))
    .filter((c) => c.code || c.name || c.weeklyCreditHours);
}

function previousInstitutions(row: ImportRow): PreviousInstitution[] {
  return [1, 2, 3]
    .map((i) => ({ institutionName: row[`previousInstitution${i}_name`]?.trim() ?? "", designation: row[`previousInstitution${i}_designation`]?.trim() ?? "", yearsWorked: num(row[`previousInstitution${i}_years`]) ?? 0 }))
    .filter((p) => p.institutionName || p.designation);
}

function publications(row: ImportRow): Publication[] {
  return [1, 2, 3]
    .map((i) => ({ title: row[`publication${i}_title`]?.trim() ?? "", coAuthors: row[`publication${i}_coAuthors`]?.trim() ?? "", journalOrConference: row[`publication${i}_journal`]?.trim() ?? "", publicationYear: num(row[`publication${i}_year`]) ?? 0, indexing: row[`publication${i}_indexing`]?.trim() ?? "" }))
    .filter((p) => p.title || p.journalOrConference);
}

function fundedProjects(row: ImportRow): FundedProject[] {
  return [1, 2, 3]
    .map((i) => {
      const roleKey = (row[`project${i}_role`] ?? "").trim().toLowerCase();
      const piOrCoPi = PI_CO_PI_MAP[roleKey];
      return {
        title: row[`project${i}_title`]?.trim() ?? "", fundingAgency: row[`project${i}_agency`]?.trim() ?? "",
        grantAmountLakhs: num(row[`project${i}_amount`]) ?? 0, year: num(row[`project${i}_year`]) ?? 0,
        status: row[`project${i}_status`]?.trim() ?? "", ...(piOrCoPi ? { piOrCoPi } : {}),
      };
    })
    .filter((p) => p.title || p.fundingAgency);
}

function promotions(row: ImportRow): PromotionRecord[] {
  return [1, 2, 3]
    .map((i) => ({ fromDesignation: row[`promotion${i}_fromDesignation`]?.trim() ?? "", toDesignation: row[`promotion${i}_toDesignation`]?.trim() ?? "", effectiveYear: num(row[`promotion${i}_effectiveYear`]) ?? 0 }))
    .filter((p) => p.fromDesignation || p.toDesignation);
}

function adminResponsibilities(row: ImportRow): AdminResponsibilityEntry[] {
  return [1, 2, 3]
    .map((i) => omitUndefined({
      category: ADMIN_RESPONSIBILITY_CATEGORY_MAP[(row[`adminResp${i}_category`] ?? "").trim().toLowerCase()] ?? "OTHER",
      description: row[`adminResp${i}_description`]?.trim() ?? "",
      fromYear: num(row[`adminResp${i}_fromYear`]),
      toYear: num(row[`adminResp${i}_toYear`]),
    }))
    .filter((a) => a.description);
}

function trainingEntries(row: ImportRow): TrainingEntry[] {
  return [1, 2, 3]
    .map((i) => omitUndefined({
      type: TRAINING_TYPE_MAP[(row[`training${i}_type`] ?? "").trim().toLowerCase()] ?? "OTHER",
      title: row[`training${i}_title`]?.trim() ?? "",
      organizer: row[`training${i}_organizer`]?.trim() ?? "",
      year: num(row[`training${i}_year`]) ?? 0,
      durationDays: num(row[`training${i}_durationDays`]),
    }))
    .filter((t) => t.title || t.organizer);
}

function professionalMemberships(row: ImportRow): ProfessionalMembership[] {
  return [1, 2, 3]
    .map((i) => {
      const bodyRaw = row[`membership${i}_body`]?.trim();
      const body = PROFESSIONAL_BODY_MAP[(bodyRaw ?? "").toLowerCase()];
      return omitUndefined({
        body: body ?? "OTHER",
        ...(!body && bodyRaw ? { otherName: bodyRaw } : row[`membership${i}_otherName`]?.trim() ? { otherName: row[`membership${i}_otherName`]!.trim() } : {}),
        membershipId: row[`membership${i}_membershipId`]?.trim() || undefined,
        sinceYear: num(row[`membership${i}_sinceYear`]),
      });
    })
    .filter((m) => m.membershipId || m.sinceYear !== undefined || m.otherName);
}

function awards(row: ImportRow): AwardEntry[] {
  return [1, 2, 3]
    .map((i) => ({
      category: AWARD_CATEGORY_MAP[(row[`award${i}_category`] ?? "").trim().toLowerCase()] ?? "OTHER",
      title: row[`award${i}_title`]?.trim() ?? "",
      awardingBody: row[`award${i}_awardingBody`]?.trim() ?? "",
      year: num(row[`award${i}_year`]) ?? 0,
    }))
    .filter((a) => a.title || a.awardingBody);
}

function courseFiles(row: ImportRow): CourseFileEntry[] {
  return [1, 2, 3]
    .map((i) => ({ courseCode: row[`courseFile${i}_courseCode`]?.trim() ?? "", courseName: row[`courseFile${i}_courseName`]?.trim() ?? "", academicYear: row[`courseFile${i}_academicYear`]?.trim() ?? "" }))
    .filter((c) => c.courseCode || c.courseName);
}

function consultancyProjects(row: ImportRow): ConsultancyProject[] {
  return [1, 2, 3]
    .map((i) => ({ title: row[`consultancy${i}_title`]?.trim() ?? "", clientOrAgency: row[`consultancy${i}_client`]?.trim() ?? "", revenueLakhs: num(row[`consultancy${i}_revenue`]) ?? 0, year: num(row[`consultancy${i}_year`]) ?? 0, status: row[`consultancy${i}_status`]?.trim() ?? "" }))
    .filter((c) => c.title || c.clientOrAgency);
}

function labsEstablished(row: ImportRow): LabEstablished[] {
  return [1, 2, 3]
    .map((i) => ({ facilityDetails: row[`lab${i}_details`]?.trim() ?? "", outcomes: row[`lab${i}_outcomes`]?.trim() ?? "" }))
    .filter((l) => l.facilityDetails || l.outcomes);
}

function authoredBooks(row: ImportRow): AuthoredBook[] {
  return [1, 2, 3]
    .map((i) => ({ title: row[`book${i}_title`]?.trim() ?? "", publisher: row[`book${i}_publisher`]?.trim() ?? "", year: num(row[`book${i}_year`]) ?? 0 }))
    .filter((b) => b.title || b.publisher);
}

function buildAcademicProfile(row: ImportRow): Record<string, unknown> | undefined {
  const profile: Record<string, unknown> = {
    highestQualification: row.highestQualification?.trim() ?? "",
    ugDetails: degree(row, "ug"),
    pgDetails: degree(row, "pg"),
    phdDetails: degree(row, "phd"),
    postDoctoralDetails: degree(row, "postdoc"),
    phdStatus: row.phdStatus?.trim().toUpperCase().includes("PURSU") ? "PURSUING" : row.phdStatus?.trim() ? "AWARDED" : undefined,
    phdMode: row.phdMode?.trim().toUpperCase().includes("PART") ? "PART_TIME" : row.phdMode?.trim() ? "FULL_TIME" : undefined,
    phdSupervisorName: row.phdSupervisorName?.trim() || undefined,
    fellowshipsReceived: row.fellowshipsReceived?.trim() || undefined,
    gateQualifiedYear: num(row.gateQualifiedYear),
    gateScore: num(row.gateScore),
    netSletQualificationYear: num(row.netSletQualificationYear),
    teachingAssignment: row.primaryTeachingRole?.trim() || courses(row).length > 0
      ? { primaryTeachingRole: row.primaryTeachingRole?.trim() ?? "", courses: courses(row) }
      : undefined,
    previousInstitutions: previousInstitutions(row),
    promotionHistory: promotions(row),
    publications: publications(row),
    publicationsFirstOrCorrespondingAuthor: num(row.publicationsFirstOrCorrespondingAuthor) ?? 0,
    publicationsQ1OrHighImpact: num(row.publicationsQ1OrHighImpact) ?? 0,
    sciScopusCount: num(row.sciScopusCount) ?? 0,
    wosCount: num(row.wosCount) ?? 0,
    conferencePapersCount: num(row.conferencePapersCount) ?? 0,
    bookChaptersCount: num(row.bookChaptersCount) ?? 0,
    reviewPublicationsCount: num(row.reviewPublicationsCount) ?? 0,
    totalPublications: num(row.totalPublications) ?? 0,
    totalCitations: num(row.totalCitations) ?? 0,
    hIndex: num(row.hIndex) ?? 0,
    i10Index: num(row.i10Index) ?? 0,
    googleScholarId: row.googleScholarId?.trim() || undefined,
    scopusAuthorId: row.scopusAuthorId?.trim() || undefined,
    orcidId: row.orcidId?.trim() || undefined,
    fundedProjects: fundedProjects(row),
    consultancyProjects: consultancyProjects(row),
    patents: {
      indianFiled: num(row.patentIndianFiled) ?? 0,
      indianPublished: num(row.patentIndianPublished) ?? 0,
      indianGranted: num(row.patentIndianGranted) ?? 0,
      internationalFiled: num(row.patentInternationalFiled) ?? 0,
      internationalPublished: num(row.patentInternationalPublished) ?? 0,
      internationalGranted: num(row.patentInternationalGranted) ?? 0,
      details: row.patentDetails?.trim() ?? "",
    },
    phdScholarsPursuing: (num(row.phdScholarsPursuingCount) || row.phdScholarsPursuingUniversities?.trim())
      ? { count: num(row.phdScholarsPursuingCount) ?? 0, universities: row.phdScholarsPursuingUniversities?.trim() ?? "" }
      : undefined,
    phdScholarsAwarded: (num(row.phdScholarsAwardedCount) || row.phdScholarsAwardedUniversities?.trim())
      ? { count: num(row.phdScholarsAwardedCount) ?? 0, universities: row.phdScholarsAwardedUniversities?.trim() ?? "" }
      : undefined,
    nationalExposure: row.nationalExposure?.trim() || undefined,
    internationalExposure: row.internationalExposure?.trim() || undefined,
    labsEstablished: labsEstablished(row),
    adminResponsibilityEntries: adminResponsibilities(row),
    administrativeResponsibilities: row.administrativeResponsibilities?.trim() || undefined,
    trainingEntries: trainingEntries(row),
    certificationsAndFdps: row.certificationsAndFdps?.trim() || undefined,
    professionalMemberships: professionalMemberships(row),
    professionalBodyMemberships: row.professionalBodyMemberships?.trim() || undefined,
    authoredBooks: authoredBooks(row),
    awardEntries: awards(row),
    notableAwards: row.notableAwards?.trim() || undefined,
    courseFilesAndCoPoMapping: courseFiles(row),
    presentSalary: num(row.presentSalary),
    grossAnnualCTC: num(row.grossAnnualCTC),
    incrementsAwarded: num(row.incrementsAwarded),
    fundingConsultancyRevenue: num(row.fundingConsultancyRevenue),
    otherInformation: row.otherInformation?.trim() || undefined,
  };
  for (const key of Object.keys(profile)) {
    if (profile[key] === undefined) delete profile[key];
  }
  return Object.keys(profile).length > 0 ? profile : undefined;
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as { records: ImportRow[] };

    if (!body.records || !Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }

    if (body.records.length > 500) {
      return NextResponse.json({ error: "Maximum 500 records per import" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;

    // Resolve HOD's department. This template has no Department column at
    // all (see HINTS: "Department is auto-assigned from your HOD profile") -
    // there's no per-row value to fall back on, so a caller this can't be
    // resolved for (a non-HOD role reaching this route via the L0-L6 role
    // inheritance that lets Principal/VP browse HOD pages, or an HOD whose
    // own profile has no department set) must be rejected up front. Silently
    // falling back to "" previously created faculty with no department at
    // all - invisible on every department's Faculty list (including their
    // own), since every list there is scoped by an exact department match.
    if (session.role !== "HOD") {
      return NextResponse.json({ error: "Only an HOD can bulk-import faculty - sign in as the HOD of the target department" }, { status: 403 });
    }
    const hodSnap = await db.collection("colleges").doc(collegeId).collection("users").doc(session.uid).get();
    const hodDept = (hodSnap.data() as { department?: string } | undefined)?.department ?? "";
    if (!hodDept) {
      return NextResponse.json({ error: "Your account has no department set - ask your Principal to assign one before importing faculty" }, { status: 400 });
    }

    // Load existing employeeIds to detect duplicates
    const existingSnap = await db.collection("colleges").doc(collegeId).collection("facultyMembers")
      .select("employeeId").get();
    const existingIds = new Set(existingSnap.docs.map((d) => (d.data() as { employeeId: string }).employeeId));

    const now = new Date();
    const created: string[] = [];
    const failed: { row: number; employeeId: string; error: string }[] = [];
    const warnings: { row: number; employeeId: string; warning: string }[] = [];
    // Firebase Auth accounts created mid-loop for rows with a Password
    // column - tracked separately because they're created one row at a time
    // (outside Firestore's batch/transaction model), so if the batch commit
    // below fails for any reason, these must be torn back down by hand or
    // they're stranded: visible to nothing in the app, yet permanently
    // blocking any retry with the same email ("email already exists").
    const createdAuthUids: string[] = [];

    const batch = new ChunkedBatch(db);

    for (let i = 0; i < body.records.length; i++) {
      const row = body.records[i];
      const rowNum = i + 2; // 1-indexed + header row

      // A value was provided but couldn't be parsed - record it was silently
      // dropped instead of just proceeding, so a typo (e.g. a mistyped year)
      // doesn't disappear without a trace the way it used to.
      const dropped = (empId: string, label: string, raw: string | undefined) => {
        warnings.push({ row: rowNum, employeeId: empId, warning: `${label} ignored - invalid value ("${raw?.trim()}")` });
      };

      // Required field validation
      if (!row.employeeId?.trim()) { failed.push({ row: rowNum, employeeId: "-", error: "Employee ID is required" }); continue; }
      if (!row.name?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Name is required" }); continue; }
      if (!row.email?.trim() || !row.email.includes("@")) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Valid email is required" }); continue; }
      if (!row.joiningDate?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Joining date is required" }); continue; }

      const empId = row.employeeId.trim();
      if (existingIds.has(empId)) {
        failed.push({ row: rowNum, employeeId: empId, error: "Employee ID already exists" });
        continue;
      }

      // Map designation
      const designationKey = (row.designation ?? "").trim().toLowerCase();
      const designation: Designation = DESIGNATION_MAP[designationKey] ?? "ASSISTANT_PROFESSOR";

      // Map employment type
      const empTypeKey = (row.employmentType ?? "").trim().toLowerCase();
      const employmentType: EmploymentType = EMPLOYMENT_MAP[empTypeKey] ?? "PERMANENT";

      // Map status
      const statusKey = (row.status ?? "").trim().toLowerCase();
      const status: FacultyStatus = STATUS_MAP[statusKey] ?? "ACTIVE";

      // Parse dates
      const joiningDate = parseDate(row.joiningDate);
      if (!joiningDate) { failed.push({ row: rowNum, employeeId: empId, error: "Invalid joining date - use YYYY-MM-DD" }); continue; }
      const dateOfBirth = parseDate(row.dateOfBirth);
      if (row.dateOfBirth?.trim() && !dateOfBirth) dropped(empId, "Date of birth", row.dateOfBirth);
      const ratificationDate = parseDate(row.ratificationDate);
      if (row.ratificationDate?.trim() && !ratificationDate) dropped(empId, "Ratification date", row.ratificationDate);
      const dateOfJoiningDepartment = parseDate(row.dateOfJoiningDepartment);
      if (row.dateOfJoiningDepartment?.trim() && !dateOfJoiningDepartment) dropped(empId, "Date of joining department", row.dateOfJoiningDepartment);

      // Parses a numeric field, warning (rather than silently zeroing/dropping
      // it) when a non-empty value fails to parse.
      const checkNum = (raw: string | undefined, label: string): number | undefined => {
        if (!raw?.trim()) return undefined;
        const n = parseFloat(raw);
        if (!Number.isFinite(n)) { dropped(empId, label, raw); return undefined; }
        return n;
      };

      // Optional login creation - a CSV row with a Password fills in the
      // faculty member's login account (role: Panel Member) right here during
      // import, so there's no separate "Set Login" step needed afterward for
      // rows that came in this way. Rows left blank still fall back to the
      // per-faculty "Set Login" button on the Faculty list (its userUid check
      // there is what keeps that button hidden once this has run).
      let userUid: string | undefined;
      const passwordRaw = row.password?.trim();
      const loginEmail = row.collegeEmail?.trim().toLowerCase() || row.email.trim().toLowerCase();
      if (passwordRaw) {
        if (passwordRaw.length < 8) {
          warnings.push({ row: rowNum, employeeId: empId, warning: "Password ignored - must be at least 8 characters (faculty record was still created without a login)" });
        } else {
          try {
            userUid = await createFirebaseUser(loginEmail, passwordRaw, row.name.trim());
            createdAuthUids.push(userUid);
          } catch (err) {
            const message = err && typeof err === "object" && "code" in err && err.code === "auth/email-already-exists"
              ? "an account with this email already exists"
              : err instanceof Error ? err.message : "unknown error";
            warnings.push({ row: rowNum, employeeId: empId, warning: `Login not created - ${message} (faculty record was still created)` });
          }
        }
      }

      const docRef = db.collection("colleges").doc(collegeId).collection("facultyMembers").doc();

      const payload: Record<string, unknown> = {
        userUid,
        collegeId,
        department: hodDept,
        employeeId: empId,
        name: row.name.trim(),
        apaarFacultyId: row.apaarFacultyId?.trim() || undefined,
        email: row.email.trim().toLowerCase(),
        phone: row.phone?.trim() ?? "",
        designation,
        qualification: row.qualification?.trim() ?? "",
        specialization: row.specialization?.trim() ?? "",
        employmentType,
        experienceYears: checkNum(row.experienceYears, "Total Experience") ?? 0,
        joiningDate,
        dateOfJoiningDepartment: dateOfJoiningDepartment || undefined,
        aicteEligible: row.aicteEligible ? row.aicteEligible.trim().toLowerCase() === "yes" : undefined,
        status,
        gender: row.gender?.trim() || undefined,
        dateOfBirth: dateOfBirth || undefined,
        legalName: row.legalName?.trim() || undefined,
        fatherName: row.fatherName?.trim() || undefined,
        motherName: row.motherName?.trim() || undefined,
        aadharNo: row.aadharNo?.trim() || undefined,
        panNo: row.panNo?.trim().toUpperCase() || undefined,
        passportNumber: row.passportNumber?.trim() || undefined,
        emergencyContactName: row.emergencyContactName?.trim() || undefined,
        emergencyContactPhone: row.emergencyContactPhone?.trim() || undefined,
        religion: row.religion?.trim() || undefined,
        caste: row.caste?.trim() || undefined,
        collegeEmail: row.collegeEmail?.trim().toLowerCase() || undefined,
        ratificationStatus: row.ratificationStatus?.toLowerCase().includes("not") ? "Not Ratified" : row.ratificationStatus?.trim() ? "Ratified" : undefined,
        ratificationDate: ratificationDate || undefined,
        hasPHD: row.hasPHD ? row.hasPHD.trim().toLowerCase() === "yes" : undefined,
        maritalStatus: row.maritalStatus?.trim().toLowerCase().startsWith("married") ? "Married" : row.maritalStatus?.trim() ? "Single" : undefined,
        spouseName: row.spouseName?.trim() || undefined,
        numberOfChildren: checkNum(row.numberOfChildren, "Number of Children"),
        referral: row.referral?.trim() || undefined,
        nativePlace: row.nativePlace?.trim() || undefined,
        bloodGroup: row.bloodGroup?.trim() || undefined,
        temporaryAddress: row.temporaryAddress?.trim() || undefined,
        permanentSameAsTemporary: row.permanentSameAsTemporary ? row.permanentSameAsTemporary.trim().toLowerCase() === "yes" : undefined,
        permanentAddress: row.permanentAddress?.trim() || undefined,
        resumeUrl: row.resumeUrl?.trim() || undefined,
        internalExperience: checkNum(row.internalExperience, "Internal Exp"),
        externalExperience: checkNum(row.externalExperience, "External Exp"),
        inCampusExperience: checkNum(row.inCampusExperience, "In Campus Exp"),
        industryExperience: checkNum(row.industryExperience, "Industry Exp"),
        researchExperience: checkNum(row.researchExperience, "Research Exp"),
        academicProfile: buildAcademicProfile(row),
        createdAt: now,
        updatedAt: now,
      };

      // Remove undefined values
      for (const key of Object.keys(payload)) {
        if (payload[key] === undefined) delete payload[key];
      }

      batch.set(docRef, payload);

      if (userUid) {
        const userRef = db.collection("colleges").doc(collegeId).collection("users").doc(userUid);
        batch.set(userRef, {
          uid: userUid,
          collegeId,
          name: row.name.trim(),
          email: loginEmail,
          role: "PANEL_MEMBER",
          department: hodDept,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
        const sysUserRef = db.collection("systemUsers").doc(userUid);
        batch.set(sysUserRef, {
          uid: userUid,
          role: "PANEL_MEMBER",
          collegeId,
          email: loginEmail,
          name: row.name.trim(),
        });
      }

      existingIds.add(empId); // prevent duplicates within the same batch
      created.push(empId);
    }

    try {
      await batch.commit();
    } catch (commitErr) {
      // Firestore rejected the whole batch - every Auth account created for
      // a row above is now stranded (nothing in Firestore references it), so
      // tear them back down before surfacing the error, or every retry with
      // the same email(s) fails with "already exists" for accounts the user
      // can't see or manage anywhere in the app.
      if (createdAuthUids.length > 0) {
        const { getAdminAuth } = await import("@/lib/firebase/admin");
        const auth = await getAdminAuth();
        await Promise.all(createdAuthUids.map((uid) =>
          auth.deleteUser(uid).catch((cleanupErr) =>
            console.error(`[faculty/import POST] Failed to roll back orphaned Auth user ${uid}:`, cleanupErr)
          )
        ));
      }
      throw commitErr;
    }

    return NextResponse.json({ created: created.length, failed, warnings }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[faculty/import POST]", err);
    const detail = process.env.NODE_ENV !== "production" ? `: ${err instanceof Error ? err.message : String(err)}` : "";
    return NextResponse.json({ error: `Internal error${detail}` }, { status: 500 });
  }
}
