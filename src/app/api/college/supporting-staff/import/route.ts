export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { splitDegreeAndBranch } from "@/lib/faculty/legacyProfileFallbacks";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { getHodTechnicalDesignations } from "@/lib/designations/config";
import { NON_TECHNICAL_STAFF_DESIGNATION_LABELS } from "@/types";
import type {
  SupportingStaffCategory, SupportingStaffDesignation, EmploymentType, FacultyStatus, CollegeType,
  SupportingStaffProfileFields, StaffQualification, TrainingEntry, TrainingEntryType, AwardEntry, AwardCategory,
  NonTechnicalResponsibility, ComputerSkill,
} from "@/types";

function designationLabel(designation: SupportingStaffDesignation): string {
  return (NON_TECHNICAL_STAFF_DESIGNATION_LABELS as Record<string, string>)[designation] ?? designation;
}

// Same resolver as faculty/students CSV imports (src/app/api/college/
// students/import-excel/route.ts) - accepts a department's short Code (e.g.
// "CSE", the template's own sample value) or its full name and normalizes to
// the canonical `name`. Without this, a row typed with a code got stored
// verbatim (e.g. department: "CSE"), which never matches the exact-string
// department filter the HOD's own Supporting Staff list queries by - the
// record was created successfully but simply never appeared for them again.
function buildDepartmentResolver(
  departmentsSnap: FirebaseFirestore.QuerySnapshot
): (input: string) => string | undefined {
  const byCodeOrName = new Map<string, string>();
  for (const d of departmentsSnap.docs) {
    const data = d.data() as { name?: string; code?: string };
    const name = (data.name ?? "").trim();
    if (!name) continue;
    byCodeOrName.set(name.toLowerCase(), name);
    const code = (data.code ?? "").trim();
    if (code) byCodeOrName.set(code.toLowerCase(), name);
  }
  return (input: string) => byCodeOrName.get(input.trim().toLowerCase());
}

// Free text (see src/lib/designations/config.ts) - normalizes the original
// fixed codes every existing Engineering/Pharmacy/Dental record and the 4
// migrated-in ex-Faculty technical codes expect; anything else (e.g. "AO",
// "PGT"-adjacent supporting titles for Degree/Polytechnic/School colleges)
// is stored exactly as typed.
const NON_TECHNICAL_DESIGNATION_MAP: Record<string, SupportingStaffDesignation> = {
  "office staff": "OFFICE_STAFF",
  "accountant": "ACCOUNTANT",
  "clerk": "CLERK",
  "attender": "ATTENDER",
  "office assistant": "OFFICE_ASSISTANT",
  "lab assistant": "LAB_ASSISTANT",
  "programmer": "PROGRAMMER",
  "system administrator": "SYSTEM_ADMINISTRATOR",
  "sysadmin": "SYSTEM_ADMINISTRATOR",
  "network engineer": "NETWORK_ENGINEER",
  "other": "OTHER",
};

const EMPLOYMENT_MAP: Record<string, EmploymentType> = {
  "permanent": "PERMANENT",
  "regular": "PERMANENT",
  "contract": "CONTRACT",
  "visiting": "VISITING",
  "part-time": "PART_TIME",
  "part time": "PART_TIME",
};

const STATUS_MAP: Record<string, FacultyStatus> = {
  "active": "ACTIVE",
  "on leave": "ON_LEAVE",
  "resigned": "RESIGNED",
  "retired": "RETIRED",
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

const AWARD_CATEGORY_MAP: Record<string, AwardCategory> = {
  "best teacher award": "BEST_TEACHER",
  "best teacher": "BEST_TEACHER",
  "research award": "RESEARCH_AWARD",
  "appreciation certificate": "APPRECIATION_CERTIFICATE",
  "appreciation": "APPRECIATION_CERTIFICATE",
  "other": "OTHER",
};

const NON_TECHNICAL_RESPONSIBILITY_MAP: Record<string, NonTechnicalResponsibility> = {
  "office administration": "OFFICE_ADMINISTRATION",
  "student records": "STUDENT_RECORDS",
  "file management": "FILE_MANAGEMENT",
  "accounts": "ACCOUNTS",
  "purchase": "PURCHASE",
  "examination work": "EXAMINATION_WORK",
  "admission support": "ADMISSION_SUPPORT",
  "documentation": "DOCUMENTATION",
  "other": "OTHER",
};

const COMPUTER_SKILL_MAP: Record<string, ComputerSkill> = {
  "ms office": "MS_OFFICE",
  "erp": "ERP",
  "excel": "EXCEL",
  "email": "EMAIL",
  "document management": "DOCUMENT_MANAGEMENT",
  "other": "OTHER",
};

type ImportRow = {
  employeeId: string;
  name: string;
  email?: string;
  password?: string;
  phone?: string;
  designation: string;
  otherDesignationTitle?: string;
  department?: string;
  employmentType: string;
  status?: string;
  joiningDate: string;
  experienceYears?: string;
  gender?: string;
  dateOfBirth?: string;
  legalName?: string;
  fatherName?: string;
  motherName?: string;
  aadharNo?: string;
  panNo?: string;
  passportNumber?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  religion?: string;
  caste?: string;
  collegeEmail?: string;
  ratificationStatus?: string;
  ratificationDate?: string;
  maritalStatus?: string;
  spouseName?: string;
  numberOfChildren?: string;
  referral?: string;
  nativePlace?: string;
  temporaryAddress?: string;
  permanentSameAsTemporary?: string;
  permanentAddress?: string;
  bloodGroup?: string;
  otherInformation?: string;
  [key: string]: string | undefined;
};

// See src/app/api/college/faculty/import/route.ts for why sane()/parseDate()
// guard this way - same lenient-Excel-date and out-of-range-year footguns apply here.
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
    return d.getMonth() === Number(mm) - 1 && d.getDate() === Number(dd) ? sane(d) : undefined;
  }
  return sane(new Date(trimmed));
}

function num(v: string | undefined): number | undefined {
  if (!v?.trim()) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseList(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

// Comma-separated free text mapped against an enum's label vocabulary - items
// that don't match anything in `map` are dropped with a warning rather than
// silently discarded, same as every other unrecognized-value case in this route.
function mapList<T extends string>(
  raw: string | undefined,
  map: Record<string, T>,
  empId: string,
  label: string,
  dropped: (empId: string, label: string, raw: string | undefined) => void
): T[] {
  const items = parseList(raw);
  const matched: T[] = [];
  for (const item of items) {
    const key = map[item.toLowerCase()];
    if (key) matched.push(key);
    else dropped(empId, label, item);
  }
  return matched;
}

function qualifications(row: ImportRow): StaffQualification[] {
  return [1, 2]
    .map((i) => {
      const combined = row[`qualification${i}_degreeAndBranch`]?.trim() ?? "";
      const { degree, branch } = splitDegreeAndBranch(combined);
      return {
        level: row[`qualification${i}_level`]?.trim() ?? "",
        degree, branch,
        universityOrInstitute: row[`qualification${i}_university`]?.trim() ?? "",
        percentageOrDivision: row[`qualification${i}_percentage`]?.trim() ?? "",
        yearOfCompletion: num(row[`qualification${i}_year`]) ?? 0,
      };
    })
    .filter((q) => q.level || q.degree || q.branch || q.universityOrInstitute);
}

function trainingEntries(row: ImportRow): TrainingEntry[] {
  return [1, 2]
    .map((i) => ({
      type: TRAINING_TYPE_MAP[(row[`training${i}_type`] ?? "").trim().toLowerCase()] ?? "OTHER",
      title: row[`training${i}_title`]?.trim() ?? "",
      organizer: row[`training${i}_organizer`]?.trim() ?? "",
      year: num(row[`training${i}_year`]) ?? 0,
    }))
    .filter((t) => t.title || t.organizer);
}

function achievementEntries(row: ImportRow): AwardEntry[] {
  return [1, 2]
    .map((i) => ({
      category: AWARD_CATEGORY_MAP[(row[`achievement${i}_category`] ?? "").trim().toLowerCase()] ?? "OTHER",
      title: row[`achievement${i}_title`]?.trim() ?? "",
      awardingBody: row[`achievement${i}_awardingBody`]?.trim() ?? "",
      year: num(row[`achievement${i}_year`]) ?? 0,
    }))
    .filter((a) => a.title || a.awardingBody);
}

// Builds the full SupportingStaffProfileFields object for a row - matches the
// manual "Add Staff" form's SupportingStaffProfileFields shape
// (src/types/supportingStaff.ts) so import and manual entry stay compatible.
function buildSupportingStaffProfile(
  row: ImportRow,
  empId: string,
  dropped: (empId: string, label: string, raw: string | undefined) => void
): SupportingStaffProfileFields | undefined {
  const profile: SupportingStaffProfileFields = {
    qualifications: qualifications(row),
  };

  const responsibilities = mapList(row.responsibilities, NON_TECHNICAL_RESPONSIBILITY_MAP, empId, "Responsibilities", dropped);
  const computerSkills = mapList(row.computerSkills, COMPUTER_SKILL_MAP, empId, "Computer Skills", dropped);
  const typingSpeedWpm = num(row.typingSpeedWpm);
  const training = trainingEntries(row);
  const achievements = achievementEntries(row);
  const hasContent = responsibilities.length || computerSkills.length || typingSpeedWpm !== undefined || training.length || achievements.length || row.otherResponsibility?.trim() || row.otherComputerSkill?.trim();
  if (hasContent) {
    profile.nonTechnicalProfile = {
      responsibilities,
      ...(row.otherResponsibility?.trim() ? { otherResponsibility: row.otherResponsibility.trim() } : {}),
      computerSkills,
      ...(row.otherComputerSkill?.trim() ? { otherComputerSkill: row.otherComputerSkill.trim() } : {}),
      ...(typingSpeedWpm !== undefined ? { typingSpeedWpm } : {}),
      training,
      achievements,
    };
  }

  if (row.otherInformation?.trim()) profile.otherInformation = row.otherInformation.trim();

  const hasQualifications = profile.qualifications.length > 0;
  return hasQualifications || profile.nonTechnicalProfile || profile.otherInformation ? profile : undefined;
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE", "HOD");
    const body = (await request.json()) as { records: ImportRow[] };

    if (!body.records || !Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }

    if (body.records.length > 500) {
      return NextResponse.json({ error: "Maximum 500 records per import" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;
    const staffCategory: SupportingStaffCategory = session.role === "HOD" ? "TECHNICAL" : "NON_TECHNICAL";

    // Some college types (School) have no Technical/Non-Technical split -
    // Supporting Staff there is centrally managed by Principal, so HOD has
    // nothing to import. Backstops the nav-hide in Sidebar.tsx.
    if (session.role === "HOD") {
      const collegeSnap = await db.collection("colleges").doc(collegeId).get();
      const collegeType = (collegeSnap.data() as { type?: CollegeType } | undefined)?.type;
      if (getHodTechnicalDesignations(collegeType).length === 0) {
        return NextResponse.json(
          { error: "Supporting Staff for your college type is managed centrally by Principal" },
          { status: 403 },
        );
      }
    }

    // HOD's imported rows are confined to their own (or owned sub-)
    // department, same as the single "Add Staff" form and the Faculty import.
    const hodScope = session.role === "HOD" ? await getHodDepartmentScope(db, collegeId, session.uid) : null;
    if (hodScope && !hodScope.departmentName) {
      return NextResponse.json({ error: "Your account has no department assigned - contact Administration" }, { status: 400 });
    }

    const existingSnap = await db.collection("colleges").doc(collegeId).collection("supportingStaff")
      .select("employeeId").get();
    const existingIds = new Set(existingSnap.docs.map((d) => (d.data() as { employeeId: string }).employeeId));

    const departmentsSnap = await db.collection("colleges").doc(collegeId).collection("departments").get();
    const resolveDepartment = buildDepartmentResolver(departmentsSnap);

    const now = new Date();
    const created: string[] = [];
    const failed: { row: number; employeeId: string; error: string }[] = [];
    const warnings: { row: number; employeeId: string; warning: string }[] = [];

    // Firebase Auth accounts created mid-loop for rows with a Password column -
    // tracked separately (see src/app/api/college/faculty/import/route.ts for
    // the same pattern) so they can be torn back down if the batch commit
    // below fails, rather than left stranded and blocking any retry with the
    // same email ("email already exists").
    const createdAuthUids: string[] = [];

    const batch = new ChunkedBatch(db);

    for (let i = 0; i < body.records.length; i++) {
      const row = body.records[i];
      const rowNum = i + 2;

      const dropped = (empId: string, label: string, raw: string | undefined) => {
        warnings.push({ row: rowNum, employeeId: empId, warning: `${label} ignored - invalid value ("${raw?.trim()}")` });
      };

      if (!row.employeeId?.trim()) { failed.push({ row: rowNum, employeeId: "-", error: "Employee ID is required" }); continue; }
      if (!row.name?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Name is required" }); continue; }
      if (!row.joiningDate?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Joining date is required" }); continue; }
      if (!row.designation?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Designation is required" }); continue; }

      const empId = row.employeeId.trim();
      if (existingIds.has(empId)) {
        failed.push({ row: rowNum, employeeId: empId, error: "Employee ID already exists" });
        continue;
      }

      const designationKey = row.designation.trim().toLowerCase();
      const designation: SupportingStaffDesignation = NON_TECHNICAL_DESIGNATION_MAP[designationKey] ?? row.designation.trim();

      const empTypeKey = (row.employmentType ?? "").trim().toLowerCase();
      const employmentType: EmploymentType = EMPLOYMENT_MAP[empTypeKey] ?? "PERMANENT";

      const statusKey = (row.status ?? "").trim().toLowerCase();
      const status: FacultyStatus = STATUS_MAP[statusKey] ?? "ACTIVE";

      const joiningDate = parseDate(row.joiningDate);
      if (!joiningDate) { failed.push({ row: rowNum, employeeId: empId, error: "Invalid joining date - use YYYY-MM-DD" }); continue; }
      const dateOfBirth = parseDate(row.dateOfBirth);
      if (row.dateOfBirth?.trim() && !dateOfBirth) dropped(empId, "Date of birth", row.dateOfBirth);
      const ratificationDate = parseDate(row.ratificationDate);
      if (row.ratificationDate?.trim() && !ratificationDate) dropped(empId, "Ratification date", row.ratificationDate);

      const checkNum = (raw: string | undefined, label: string): number | undefined => {
        if (!raw?.trim()) return undefined;
        const n = parseFloat(raw);
        if (!Number.isFinite(n)) { dropped(empId, label, raw); return undefined; }
        return n;
      };

      let department = row.department?.trim() || "";
      if (department) {
        const resolved = resolveDepartment(department);
        if (resolved) {
          department = resolved;
        } else {
          dropped(empId, "Department", department);
          department = "";
        }
      }
      if (hodScope) {
        if (department && !canHodEditDepartment(hodScope, department)) {
          dropped(empId, "Department", `${department} (not yours or one of your sub-departments)`);
          department = "";
        }
        if (!department) department = hodScope.departmentName;
      }

      // Optional login creation - a CSV row with a Password fills in this
      // staff member's login account right here during import, mirroring the
      // faculty import's behavior (src/app/api/college/faculty/import/route.ts).
      let userUid: string | undefined;
      const passwordRaw = row.password?.trim();
      const loginEmail = row.collegeEmail?.trim().toLowerCase() || row.email?.trim().toLowerCase();
      if (passwordRaw) {
        if (!loginEmail) {
          warnings.push({ row: rowNum, employeeId: empId, warning: "Password ignored - a Personal Email or College Email is required to create a login (staff record was still created)" });
        } else if (passwordRaw.length < 8) {
          warnings.push({ row: rowNum, employeeId: empId, warning: "Password ignored - must be at least 8 characters (staff record was still created without a login)" });
        } else {
          try {
            userUid = await createFirebaseUser(loginEmail, passwordRaw, row.name.trim());
            createdAuthUids.push(userUid);
          } catch (err) {
            const message = err && typeof err === "object" && "code" in err && err.code === "auth/email-already-exists"
              ? "an account with this email already exists"
              : err instanceof Error ? err.message : "unknown error";
            warnings.push({ row: rowNum, employeeId: empId, warning: `Login not created - ${message} (staff record was still created)` });
          }
        }
      }

      const docRef = db.collection("colleges").doc(collegeId).collection("supportingStaff").doc();

      const payload: Record<string, unknown> = {
        userUid,
        collegeId,
        department: department || undefined,
        employeeId: empId,
        name: row.name.trim(),
        email: row.email?.trim() || undefined,
        phone: row.phone?.trim() ?? "",
        staffCategory,
        designation,
        otherDesignationTitle: row.otherDesignationTitle?.trim() || undefined,
        experienceYears: checkNum(row.experienceYears, "Experience") ?? 0,
        joiningDate,
        employmentType,
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
        maritalStatus: row.maritalStatus?.trim().toLowerCase().startsWith("married") ? "Married" : row.maritalStatus?.trim() ? "Single" : undefined,
        spouseName: row.spouseName?.trim() || undefined,
        numberOfChildren: checkNum(row.numberOfChildren, "Number of Children"),
        referral: row.referral?.trim() || undefined,
        nativePlace: row.nativePlace?.trim() || undefined,
        bloodGroup: row.bloodGroup?.trim() || undefined,
        temporaryAddress: row.temporaryAddress?.trim() || undefined,
        permanentSameAsTemporary: row.permanentSameAsTemporary ? row.permanentSameAsTemporary.trim().toLowerCase() === "yes" : undefined,
        permanentAddress: row.permanentAddress?.trim() || undefined,
        supportingStaffProfile: buildSupportingStaffProfile(row, empId, dropped),
        createdAt: now,
        updatedAt: now,
      };

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
          role: "COLLEGE_STAFF",
          designation: designationLabel(designation),
          ...(department ? { department } : {}),
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
        const sysUserRef = db.collection("systemUsers").doc(userUid);
        batch.set(sysUserRef, {
          uid: userUid,
          role: "COLLEGE_STAFF",
          collegeId,
          email: loginEmail,
          name: row.name.trim(),
        });
      }

      existingIds.add(empId);
      created.push(empId);
    }

    try {
      await batch.commit();
    } catch (commitErr) {
      if (createdAuthUids.length > 0) {
        const { getAdminAuth } = await import("@/lib/firebase/admin");
        const auth = await getAdminAuth();
        await Promise.all(createdAuthUids.map((uid) =>
          auth.deleteUser(uid).catch((cleanupErr) =>
            console.error(`[supporting-staff/import POST] Failed to roll back orphaned Auth user ${uid}:`, cleanupErr)
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
    console.error("[supporting-staff/import POST]", err);
    const detail = process.env.NODE_ENV !== "production" ? `: ${err instanceof Error ? err.message : String(err)}` : "";
    return NextResponse.json({ error: `Internal error${detail}` }, { status: 500 });
  }
}
