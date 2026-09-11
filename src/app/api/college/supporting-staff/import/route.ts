export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { splitDegreeAndBranch } from "@/lib/faculty/legacyProfileFallbacks";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { hasSupportingStaffSplit } from "@/lib/designations/config";
import { NON_TECHNICAL_STAFF_DESIGNATION_LABELS } from "@/types";
import {
  matchOption, normalizeDigits, isScientificNotation,
  GENDER_OPTIONS, RATIFICATION_STATUS_OPTIONS,
} from "@/lib/import/fieldConstraints";
import type {
  SupportingStaffCategory, SupportingStaffDesignation, FacultyStatus, CollegeType,
  SupportingStaffProfileFields, StaffQualification, TrainingEntry, TrainingEntryType, AwardEntry, AwardCategory,
  NonTechnicalResponsibility, ComputerSkill,
} from "@/types";

function designationLabel(designation: SupportingStaffDesignation): string {
  return (NON_TECHNICAL_STAFF_DESIGNATION_LABELS as Record<string, string>)[designation] ?? designation;
}

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
  legalName: string;
  name: string;
  collegeEmail: string;
  password: string;
  phone: string;
  designation: string;
  qualification: string;
  joiningDate: string;
  gender: string;
  dateOfBirth: string;
  nameAsPerAadhar: string;
  aadharNo: string;
  panNo: string;
  ratificationStatus: string;
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

    const collegeDocSnap = await db.collection("colleges").doc(collegeId).get();
    const collegeType = (collegeDocSnap.data() as { type?: CollegeType } | undefined)?.type;

    // Some college types (School) have no Technical/Non-Technical split -
    // Supporting Staff there is centrally managed by Principal, so HOD has
    // nothing to import. Backstops the nav-hide in Sidebar.tsx.
    if (session.role === "HOD" && !hasSupportingStaffSplit(collegeType)) {
      return NextResponse.json(
        { error: "Supporting Staff for your college type is managed centrally by Principal" },
        { status: 403 },
      );
    }

    // The designation catalogue this import is allowed to use - this
    // college's own admin-curated Technical (HOD's Supporting Staff) or
    // Non-Technical (College Office's Non-Technical Staff) list, same split
    // the manual Add/Edit forms enforce (see DesignationCatalogCard).
    const designationSnap = await db.collection("colleges").doc(collegeId).collection("designations")
      .where("category", "==", staffCategory).where("isActive", "==", true).get();
    const allowedDesignations = designationSnap.docs
      .map((d) => (d.data() as { name?: string }).name)
      .filter((n): n is string => !!n);

    // HOD's imported rows are confined to their own (or owned sub-)
    // department, same as the single "Add Staff" form and the Faculty import.
    const hodScope = session.role === "HOD" ? await getHodDepartmentScope(db, collegeId, session.uid) : null;
    if (hodScope && !hodScope.departmentName) {
      return NextResponse.json({ error: "Your account has no department assigned - contact Administration" }, { status: 400 });
    }

    const existingSnap = await db.collection("colleges").doc(collegeId).collection("supportingStaff")
      .select("employeeId").get();
    const existingIds = new Set(existingSnap.docs.map((d) => (d.data() as { employeeId: string }).employeeId));

    // No Department column in the import template - HOD's rows default to
    // their own department (same as the single "Add Staff" form); College
    // Office's Non-Technical rows import with no department and can be
    // assigned one afterward from the staff member's own Edit page.
    const department = hodScope ? hodScope.departmentName : "";

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

      // A value that breaks its column's stated constraint rejects the whole
      // row, rather than importing the record with that one field quietly
      // missing - see the matching gate below.
      const rowErrors: string[] = [];
      const dropped = (_empId: string, label: string, raw: string | undefined) => {
        rowErrors.push(`${label}: invalid value ("${raw?.trim()}")`);
      };

      // Each cell is held to the option set its template column states; a value
      // outside it is dropped with a warning rather than stored, so an import
      // can't produce a status the Add/Edit dropdowns could never show.
      const checkOption = (raw: string | undefined, options: readonly string[], label: string) => {
        if (!raw?.trim()) return undefined;
        const matched = matchOption(raw, options);
        if (!matched) dropped(empId, label, raw);
        return matched;
      };
      // Excel turns a long number column into "9E+09" on export - expanded back
      // to digits so the stored value is dialable, and flagged, since the sheet
      // itself has already lost the original digits.
      const checkPhone = (raw: string | undefined, label: string) => {
        if (!raw?.trim()) return undefined;
        if (isScientificNotation(raw)) {
          warnings.push({
            row: rowNum, employeeId: empId,
            warning: `${label} was stored by Excel as a number ("${raw.trim()}") and has lost its original digits - imported as ${normalizeDigits(raw)}; format that column as Text and re-upload to correct it.`,
          });
        }
        return normalizeDigits(raw);
      };

      // Required field validation - every column in the template
      // (src/lib/supportingStaff/csvColumns.ts PERSONAL_COLUMNS) is mandatory
      // except Name (as per PAN) and Name (as per Aadhar), which are optional.
      if (!row.employeeId?.trim()) { failed.push({ row: rowNum, employeeId: "-", error: "Employee ID is required" }); continue; }
      if (!row.legalName?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Full Name (as per SSC) is required" }); continue; }
      if (!row.collegeEmail?.trim() || !row.collegeEmail.includes("@")) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Valid College Email is required" }); continue; }
      if (!row.password?.trim() || row.password.trim().length < 8) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Login Password is required and must be at least 8 characters" }); continue; }
      if (!row.phone?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Mobile No is required" }); continue; }
      if (!row.designation?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Designation is required" }); continue; }
      if (!row.qualification?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Highest Qualification is required" }); continue; }
      if (!row.joiningDate?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Date of Joining Institution is required" }); continue; }
      if (!row.gender?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Gender is required" }); continue; }
      if (!row.dateOfBirth?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Date of Birth is required" }); continue; }
      if (!row.aadharNo?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Aadhar No is required" }); continue; }
      if (!row.panNo?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "PAN No is required" }); continue; }
      if (!row.ratificationStatus?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Ratification Status is required" }); continue; }

      const empId = row.employeeId.trim();
      if (existingIds.has(empId)) {
        failed.push({ row: rowNum, employeeId: empId, error: "Employee ID already exists" });
        continue;
      }

      // Map designation - held to this college's own admin-curated catalog
      // for this importer's Technical/Non-Technical category
      // (allowedDesignations), not free text. matchOption normalizes case/
      // punctuation/spacing, but the admin's own chosen wording is the only
      // thing accepted - anything else rejects the row rather than storing
      // it as typed.
      const designationRaw = row.designation.trim();
      const matched = matchOption(designationRaw, allowedDesignations);
      if (!matched) {
        failed.push({
          row: rowNum, employeeId: empId,
          error: `Designation "${designationRaw}" is not one of the ${staffCategory === "TECHNICAL" ? "Technical" : "Non-Technical"} titles your college allows (${allowedDesignations.join(" / ")})`,
        });
        continue;
      }
      const designation: SupportingStaffDesignation = matched;

      const status: FacultyStatus = "ACTIVE";

      const joiningDate = parseDate(row.joiningDate);
      if (!joiningDate) { failed.push({ row: rowNum, employeeId: empId, error: "Invalid Date of Joining Institution - use YYYY-MM-DD" }); continue; }
      const dateOfBirth = parseDate(row.dateOfBirth);
      if (!dateOfBirth) dropped(empId, "Date of Birth", row.dateOfBirth);

      // Computed here, ABOVE the gate, not inline in the payload literal below:
      // that literal is built after the gate, so a constraint failing there was
      // recorded too late to reject the row - an invalid Gender ("M") was
      // dropped and the record imported with it blank.
      const vPhone = checkPhone(row.phone, "Phone");
      const vGender = checkOption(row.gender, GENDER_OPTIONS, "Gender");
      const vRatification = checkOption(row.ratificationStatus, RATIFICATION_STATUS_OPTIONS, "Ratification Status");

      // Every constraint the template states has now been checked. Anything
      // that failed one rejects the row here - before the login below, so a
      // skipped row can't leave an orphaned Firebase Auth account behind.
      if (rowErrors.length > 0) {
        failed.push({ row: rowNum, employeeId: empId, error: rowErrors.join("; ") });
        continue;
      }

      // Login creation - mandatory now that Login Password is a required
      // column, so every imported row gets a login account immediately, no
      // separate login-setup step needed afterward. A failure here (e.g. the
      // email is already registered to some other Auth account) rejects the
      // whole row for correction, same as every other constraint above.
      const passwordRaw = row.password.trim();
      const loginEmail = row.collegeEmail.trim().toLowerCase();
      // Name (as per PAN) is optional - stored on the record verbatim (falls
      // back to "" when blank). The login account's display name follows
      // Full Name (as per SSC) first, same precedence as the manual Add form
      // (finalName) and supportingStaffDisplayName() - row.legalName is
      // already guaranteed non-blank by the required-field check above.
      const staffName = row.name?.trim() ?? "";
      const finalName = row.legalName.trim() || staffName || "";
      let userUid: string;
      try {
        userUid = await createFirebaseUser(loginEmail, passwordRaw, finalName);
        createdAuthUids.push(userUid);
      } catch (err) {
        const message = err && typeof err === "object" && "code" in err && err.code === "auth/email-already-exists"
          ? "an account with this email already exists"
          : err instanceof Error ? err.message : "unknown error";
        failed.push({ row: rowNum, employeeId: empId, error: `Login not created - ${message}` });
        continue;
      }

      const docRef = db.collection("colleges").doc(collegeId).collection("supportingStaff").doc();

      const payload: Record<string, unknown> = {
        userUid,
        collegeId,
        department: department || undefined,
        employeeId: empId,
        name: staffName,
        phone: vPhone ?? "",
        staffCategory,
        designation,
        qualification: row.qualification.trim(),
        experienceYears: 0,
        joiningDate,
        status,
        gender: vGender,
        dateOfBirth: dateOfBirth || undefined,
        legalName: row.legalName.trim(),
        nameAsPerAadhar: row.nameAsPerAadhar?.trim() || undefined,
        aadharNo: normalizeDigits(row.aadharNo),
        panNo: row.panNo.trim().toUpperCase(),
        collegeEmail: loginEmail,
        ratificationStatus: vRatification,
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
          name: finalName,
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
          name: finalName,
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
