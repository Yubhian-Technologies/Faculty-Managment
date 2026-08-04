export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { SupportingStaffCategory, SupportingStaffDesignation, EmploymentType, FacultyStatus } from "@/types";

// Same resolver as faculty/students CSV imports (src/app/api/college/
// students/import-excel/route.ts) — accepts a department's short Code (e.g.
// "CSE", the template's own sample value) or its full name and normalizes to
// the canonical `name`. Without this, a row typed with a code got stored
// verbatim (e.g. department: "CSE"), which never matches the exact-string
// department filter the HOD's own Supporting Staff list queries by — the
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
// guard this way — same lenient-Excel-date and out-of-range-year footguns apply here.
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

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
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
        warnings.push({ row: rowNum, employeeId: empId, warning: `${label} ignored — invalid value ("${raw?.trim()}")` });
      };

      if (!row.employeeId?.trim()) { failed.push({ row: rowNum, employeeId: "—", error: "Employee ID is required" }); continue; }
      if (!row.name?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Name is required" }); continue; }
      if (!row.joiningDate?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Joining date is required" }); continue; }

      const empId = row.employeeId.trim();
      if (existingIds.has(empId)) {
        failed.push({ row: rowNum, employeeId: empId, error: "Employee ID already exists" });
        continue;
      }

      const categoryKey = (row.staffCategory ?? "").trim().toLowerCase();
      const staffCategory: SupportingStaffCategory = CATEGORY_MAP[categoryKey] ?? "NON_TECHNICAL";
      if (row.staffCategory?.trim() && !CATEGORY_MAP[categoryKey]) dropped(empId, "Staff Category", row.staffCategory);

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
      if (!joiningDate) { failed.push({ row: rowNum, employeeId: empId, error: "Invalid joining date — use YYYY-MM-DD" }); continue; }
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
        supportingStaffProfile: row.otherInformation?.trim() ? { qualifications: [], otherInformation: row.otherInformation.trim() } : undefined,
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
