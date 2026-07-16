export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Designation, EmploymentType, FacultyStatus, DegreeDetail, CourseAssignment, FundedProject, ConsultancyProject, LabEstablished, AuthoredBook } from "@/types";

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
  "technical": "TECHNICAL",
  "non-technical": "NON_TECHNICAL",
  "non technical": "NON_TECHNICAL",
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

type ImportRow = {
  employeeId: string;
  name: string;
  email: string;
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
  // Academic Profile (Modules 1-5) — flattened columns, all optional
  [key: string]: string | undefined;
};

function num(v: string | undefined): number | undefined {
  if (!v?.trim()) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
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

function fundedProjects(row: ImportRow): FundedProject[] {
  return [1, 2, 3]
    .map((i) => ({ title: row[`project${i}_title`]?.trim() ?? "", fundingAgency: row[`project${i}_agency`]?.trim() ?? "", grantAmountLakhs: num(row[`project${i}_amount`]) ?? 0, year: num(row[`project${i}_year`]) ?? 0, status: row[`project${i}_status`]?.trim() ?? "" }))
    .filter((p) => p.title || p.fundingAgency);
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
    phdStatus: row.phdStatus?.trim().toUpperCase().includes("PURSU") ? "PURSUING" : row.phdStatus?.trim() ? "AWARDED" : undefined,
    phdMode: row.phdMode?.trim().toUpperCase().includes("PART") ? "PART_TIME" : row.phdMode?.trim() ? "FULL_TIME" : undefined,
    phdSupervisorName: row.phdSupervisorName?.trim() || undefined,
    fellowshipsReceived: row.fellowshipsReceived?.trim() || undefined,
    gateQualifiedYear: num(row.gateQualifiedYear),
    gateScore: num(row.gateScore),
    netSletQualificationYear: num(row.netSletQualificationYear),
    teachingExperienceBeforeJoiningYears: num(row.teachingExperienceBeforeJoiningYears) ?? 0,
    teachingExperienceSinceJoiningYears: num(row.teachingExperienceSinceJoiningYears) ?? 0,
    researchOrIndustryExperienceYears: num(row.researchOrIndustryExperienceYears) ?? 0,
    totalProfessionalExperienceYears: num(row.totalProfessionalExperienceYears) ?? 0,
    totalWeeklyTeachingLoadHours: num(row.totalWeeklyTeachingLoadHours) ?? 0,
    averageStudentFeedbackScore: num(row.averageStudentFeedbackScore),
    teachingAssignment: row.primaryTeachingRole?.trim() || courses(row).length > 0
      ? { primaryTeachingRole: row.primaryTeachingRole?.trim() ?? "", courses: courses(row) }
      : undefined,
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
    fundedProjects: fundedProjects(row),
    consultancyProjects: consultancyProjects(row),
    patents: {
      indianFiled: num(row.patentIndianFiled) ?? 0,
      indianPublished: num(row.patentIndianPublished) ?? 0,
      indianGranted: num(row.patentIndianGranted) ?? 0,
      internationalFiled: num(row.patentInternationalFiled) ?? 0,
      internationalPublished: num(row.patentInternationalPublished) ?? 0,
      internationalGranted: num(row.patentInternationalGranted) ?? 0,
      details: row.patentDetails?.trim() || undefined,
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
    administrativeResponsibilities: row.administrativeResponsibilities?.trim() || undefined,
    certificationsAndFdps: row.certificationsAndFdps?.trim() || undefined,
    professionalBodyMemberships: row.professionalBodyMemberships?.trim() || undefined,
    authoredBooks: authoredBooks(row),
    notableAwards: row.notableAwards?.trim() || undefined,
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

    // Resolve HOD's department
    let hodDept = "";
    if (session.role === "HOD") {
      const hodSnap = await db.collection("colleges").doc(collegeId).collection("users").doc(session.uid).get();
      hodDept = (hodSnap.data() as { department?: string } | undefined)?.department ?? "";
    }

    // Load existing employeeIds to detect duplicates
    const existingSnap = await db.collection("colleges").doc(collegeId).collection("facultyMembers")
      .select("employeeId").get();
    const existingIds = new Set(existingSnap.docs.map((d) => (d.data() as { employeeId: string }).employeeId));

    const now = new Date();
    const created: string[] = [];
    const failed: { row: number; employeeId: string; error: string }[] = [];

    const batch = db.batch();
    let batchCount = 0;

    for (let i = 0; i < body.records.length; i++) {
      const row = body.records[i];
      const rowNum = i + 2; // 1-indexed + header row

      // Required field validation
      if (!row.employeeId?.trim()) { failed.push({ row: rowNum, employeeId: "—", error: "Employee ID is required" }); continue; }
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
      const joiningDate = row.joiningDate ? new Date(row.joiningDate) : now;
      const dateOfBirth = row.dateOfBirth ? new Date(row.dateOfBirth) : undefined;
      const ratificationDate = row.ratificationDate ? new Date(row.ratificationDate) : undefined;

      // Determine department
      const department = hodDept || "";

      const docRef = db.collection("colleges").doc(collegeId).collection("facultyMembers").doc();

      const payload: Record<string, unknown> = {
        collegeId,
        department,
        employeeId: empId,
        name: row.name.trim(),
        email: row.email.trim().toLowerCase(),
        phone: row.phone?.trim() ?? "",
        designation,
        qualification: row.qualification?.trim() ?? "",
        specialization: row.specialization?.trim() ?? "",
        employmentType,
        experienceYears: parseFloat(row.experienceYears ?? "0") || 0,
        joiningDate,
        status,
        gender: row.gender?.trim() || undefined,
        dateOfBirth: dateOfBirth || undefined,
        legalName: row.legalName?.trim() || undefined,
        fatherName: row.fatherName?.trim() || undefined,
        motherName: row.motherName?.trim() || undefined,
        aadharNo: row.aadharNo?.trim() || undefined,
        panNo: row.panNo?.trim().toUpperCase() || undefined,
        religion: row.religion?.trim() || undefined,
        caste: row.caste?.trim() || undefined,
        collegeEmail: row.collegeEmail?.trim().toLowerCase() || undefined,
        ratificationStatus: row.ratificationStatus?.toLowerCase().includes("not") ? "Not Ratified" : row.ratificationStatus?.trim() ? "Ratified" : undefined,
        ratificationDate: ratificationDate || undefined,
        hasPHD: row.hasPHD ? row.hasPHD.trim().toLowerCase() === "yes" : undefined,
        maritalStatus: row.maritalStatus?.trim().toLowerCase().startsWith("married") ? "Married" : row.maritalStatus?.trim() ? "Single" : undefined,
        spouseName: row.spouseName?.trim() || undefined,
        numberOfChildren: row.numberOfChildren ? parseFloat(row.numberOfChildren) || undefined : undefined,
        referral: row.referral?.trim() || undefined,
        nativePlace: row.nativePlace?.trim() || undefined,
        bloodGroup: row.bloodGroup?.trim() || undefined,
        temporaryAddress: row.temporaryAddress?.trim() || undefined,
        permanentSameAsTemporary: row.permanentSameAsTemporary ? row.permanentSameAsTemporary.trim().toLowerCase() === "yes" : undefined,
        permanentAddress: row.permanentAddress?.trim() || undefined,
        internalExperience: row.internalExperience ? parseFloat(row.internalExperience) || undefined : undefined,
        externalExperience: row.externalExperience ? parseFloat(row.externalExperience) || undefined : undefined,
        inCampusExperience: row.inCampusExperience ? parseFloat(row.inCampusExperience) || undefined : undefined,
        industryExperience: row.industryExperience ? parseFloat(row.industryExperience) || undefined : undefined,
        researchExperience: row.researchExperience ? parseFloat(row.researchExperience) || undefined : undefined,
        academicProfile: buildAcademicProfile(row),
        createdAt: now,
        updatedAt: now,
      };

      // Remove undefined values
      for (const key of Object.keys(payload)) {
        if (payload[key] === undefined) delete payload[key];
      }

      batch.set(docRef, payload);
      existingIds.add(empId); // prevent duplicates within the same batch
      created.push(empId);
      batchCount++;

      // Firestore batch limit is 500 writes
      if (batchCount === 499) break;
    }

    await batch.commit();

    return NextResponse.json({ created: created.length, failed }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[faculty/import POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
