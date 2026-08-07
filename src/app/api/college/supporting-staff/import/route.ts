export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { SUPPORTING_STAFF_ROLE_CATEGORY, supportingStaffCategoryLabel } from "@/lib/supportingStaff/roleCategory";
import type {
  SupportingStaffCategory, SupportingStaffDesignation, EmploymentType, FacultyStatus,
  SupportingStaffProfileFields, StaffQualification, TrainingEntry, TrainingEntryType, AwardEntry, AwardCategory,
  TechnicalResponsibility, NonTechnicalResponsibility, ComputerSkill, VendorCertification, VendorCertificationEntry,
} from "@/types";

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

const CATEGORY_MAP: Record<string, SupportingStaffCategory> = {
  "technical": "TECHNICAL",
  "non-technical": "NON_TECHNICAL",
  "non technical": "NON_TECHNICAL",
  "nontechnical": "NON_TECHNICAL",
};

const TECHNICAL_DESIGNATION_MAP: Record<string, SupportingStaffDesignation> = {
  "lab assistant": "LAB_ASSISTANT",
  "programmer": "PROGRAMMER",
  "system administrator": "SYSTEM_ADMINISTRATOR",
  "sysadmin": "SYSTEM_ADMINISTRATOR",
  "network engineer": "NETWORK_ENGINEER",
  "other": "OTHER",
};

const NON_TECHNICAL_DESIGNATION_MAP: Record<string, SupportingStaffDesignation> = {
  "office staff": "OFFICE_STAFF",
  "accountant": "ACCOUNTANT",
  "librarian": "LIBRARIAN",
  "clerk": "CLERK",
  "attender": "ATTENDER",
  "office assistant": "OFFICE_ASSISTANT",
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

const TECHNICAL_RESPONSIBILITY_MAP: Record<string, TechnicalResponsibility> = {
  "lab maintenance": "LAB_MAINTENANCE",
  "equipment maintenance": "EQUIPMENT_MAINTENANCE",
  "software installation": "SOFTWARE_INSTALLATION",
  "network administration": "NETWORK_ADMINISTRATION",
  "lab stock maintenance": "LAB_STOCK_MANAGEMENT",
  "lab stock management": "LAB_STOCK_MANAGEMENT",
  "student support": "STUDENT_SUPPORT",
  "practical sessions": "PRACTICAL_SESSION_ASSISTANCE",
  "practical session assistance": "PRACTICAL_SESSION_ASSISTANCE",
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

const VENDOR_CERTIFICATION_MAP: Record<string, VendorCertification> = {
  "cisco": "CISCO",
  "microsoft": "MICROSOFT",
  "aws": "AWS",
  "redhat": "REDHAT",
  "red hat": "REDHAT",
  "oracle": "ORACLE",
  "google": "GOOGLE",
  "vmware": "VMWARE",
  "other": "OTHER",
};

type ImportRow = {
  employeeId: string;
  name: string;
  email?: string;
  phone?: string;
  staffCategory: string;
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
    .map((i) => ({
      level: row[`qualification${i}_level`]?.trim() ?? "",
      degreeAndBranch: row[`qualification${i}_degreeAndBranch`]?.trim() ?? "",
      universityOrInstitute: row[`qualification${i}_university`]?.trim() ?? "",
      percentageOrDivision: row[`qualification${i}_percentage`]?.trim() ?? "",
      yearOfCompletion: num(row[`qualification${i}_year`]) ?? 0,
    }))
    .filter((q) => q.level || q.degreeAndBranch || q.universityOrInstitute);
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

function technicalCertifications(row: ImportRow, empId: string, dropped: (empId: string, label: string, raw: string | undefined) => void): VendorCertificationEntry[] {
  return [1, 2]
    .map((i): VendorCertificationEntry | undefined => {
      const vendorRaw = row[`certification${i}_vendor`]?.trim();
      const name = row[`certification${i}_name`]?.trim() ?? "";
      const year = num(row[`certification${i}_year`]);
      if (!vendorRaw && !name) return undefined;
      const vendor = VENDOR_CERTIFICATION_MAP[(vendorRaw ?? "").toLowerCase()];
      if (vendorRaw && !vendor) dropped(empId, `Certification ${i} Vendor`, vendorRaw);
      return { vendor: vendor ?? "OTHER", ...(!vendor && vendorRaw ? { otherVendorName: vendorRaw } : {}), certificationName: name, ...(year !== undefined ? { year } : {}) };
    })
    .filter((c): c is VendorCertificationEntry => !!c);
}

// Builds the full SupportingStaffProfileFields object for a row - qualifications
// are shared across both categories; technicalProfile/nonTechnicalProfile are
// mutually exclusive, matching the manual "Add Staff" form's SupportingStaffProfileFields
// shape (src/types/supportingStaff.ts) so import and manual entry stay compatible.
function buildSupportingStaffProfile(
  row: ImportRow,
  category: SupportingStaffCategory,
  empId: string,
  dropped: (empId: string, label: string, raw: string | undefined) => void
): SupportingStaffProfileFields | undefined {
  const profile: SupportingStaffProfileFields = {
    qualifications: qualifications(row),
  };

  if (category === "TECHNICAL") {
    const responsibilities = mapList(row.responsibilities, TECHNICAL_RESPONSIBILITY_MAP, empId, "Responsibilities", dropped);
    const skills = {
      programmingLanguages: parseList(row.programmingLanguages),
      operatingSystems: parseList(row.operatingSystems),
      networking: parseList(row.networking),
      databases: parseList(row.databases),
      cloud: parseList(row.cloud),
      hardware: parseList(row.hardware),
      softwareTools: parseList(row.softwareTools),
    };
    const certifications = technicalCertifications(row, empId, dropped);
    const training = trainingEntries(row);
    const achievements = achievementEntries(row);
    const hasContent = responsibilities.length || Object.values(skills).some((s) => s.length) || certifications.length || training.length || achievements.length || row.innovationsAndAutomation?.trim() || row.otherResponsibility?.trim();
    if (hasContent) {
      profile.technicalProfile = {
        skills,
        responsibilities,
        ...(row.otherResponsibility?.trim() ? { otherResponsibility: row.otherResponsibility.trim() } : {}),
        certifications,
        training,
        ...(row.innovationsAndAutomation?.trim() ? { innovationsAndAutomation: row.innovationsAndAutomation.trim() } : {}),
        achievements,
      };
    }
  } else {
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
  }

  if (row.otherInformation?.trim()) profile.otherInformation = row.otherInformation.trim();

  const hasQualifications = profile.qualifications.length > 0;
  const hasCategoryProfile = !!profile.technicalProfile || !!profile.nonTechnicalProfile;
  return hasQualifications || hasCategoryProfile || profile.otherInformation ? profile : undefined;
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "COLLEGE_OFFICE");
    const requiredCategory = SUPPORTING_STAFF_ROLE_CATEGORY[session.role];
    const body = (await request.json()) as { records: ImportRow[] };

    if (!body.records || !Array.isArray(body.records) || body.records.length === 0) {
      return NextResponse.json({ error: "No records provided" }, { status: 400 });
    }

    if (body.records.length > 500) {
      return NextResponse.json({ error: "Maximum 500 records per import" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;

    // Resolve HOD's department (same auto-fill rule as the single "Add Staff" form).
    let hodDept = "";
    if (session.role === "HOD") {
      const hodSnap = await db.collection("colleges").doc(collegeId).collection("users").doc(session.uid).get();
      hodDept = (hodSnap.data() as { department?: string } | undefined)?.department ?? "";
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

    const batch = db.batch();
    let batchCount = 0;

    for (let i = 0; i < body.records.length; i++) {
      const row = body.records[i];
      const rowNum = i + 2;

      const dropped = (empId: string, label: string, raw: string | undefined) => {
        warnings.push({ row: rowNum, employeeId: empId, warning: `${label} ignored - invalid value ("${raw?.trim()}")` });
      };

      if (!row.employeeId?.trim()) { failed.push({ row: rowNum, employeeId: "-", error: "Employee ID is required" }); continue; }
      if (!row.name?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Name is required" }); continue; }
      if (!row.joiningDate?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Joining date is required" }); continue; }

      const empId = row.employeeId.trim();
      if (existingIds.has(empId)) {
        failed.push({ row: rowNum, employeeId: empId, error: "Employee ID already exists" });
        continue;
      }

      const categoryKey = (row.staffCategory ?? "").trim().toLowerCase();
      const staffCategory: SupportingStaffCategory = CATEGORY_MAP[categoryKey] ?? requiredCategory ?? "TECHNICAL";
      if (row.staffCategory?.trim() && !CATEGORY_MAP[categoryKey]) dropped(empId, "Staff Category", row.staffCategory);

      // Each role can only import into its own category - Technical (HOD, per
      // department) and Non-Technical (College Office, college-wide) are kept separate.
      if (requiredCategory && staffCategory !== requiredCategory) {
        failed.push({ row: rowNum, employeeId: empId, error: `${session.role === "HOD" ? "HOD" : "College Office"} can only import ${supportingStaffCategoryLabel(requiredCategory)} staff` });
        continue;
      }

      const designationKey = (row.designation ?? "").trim().toLowerCase();
      const designationMap = staffCategory === "TECHNICAL" ? TECHNICAL_DESIGNATION_MAP : NON_TECHNICAL_DESIGNATION_MAP;
      const designation: SupportingStaffDesignation = designationMap[designationKey] ?? "OTHER";
      if (designation === "OTHER" && designationKey && designationKey !== "other" && !row.otherDesignationTitle?.trim()) {
        dropped(empId, "Designation", row.designation);
      }

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
          department = session.role === "HOD" ? hodDept : "";
        }
      } else {
        department = session.role === "HOD" ? hodDept : "";
      }

      const docRef = db.collection("colleges").doc(collegeId).collection("supportingStaff").doc();

      const payload: Record<string, unknown> = {
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
        supportingStaffProfile: buildSupportingStaffProfile(row, staffCategory, empId, dropped),
        createdAt: now,
        updatedAt: now,
      };

      for (const key of Object.keys(payload)) {
        if (payload[key] === undefined) delete payload[key];
      }

      batch.set(docRef, payload);
      existingIds.add(empId);
      created.push(empId);
      batchCount++;

      if (batchCount === 499) break;
    }

    await batch.commit();

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
