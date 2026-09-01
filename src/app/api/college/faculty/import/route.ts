export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import {
  matchOption, parseYesNoStrict, normalizeDigits, isScientificNotation,
  GENDER_OPTIONS, BLOOD_GROUP_OPTIONS, MARITAL_STATUS_OPTIONS,
  RATIFICATION_STATUS_OPTIONS, RELIGION_OPTIONS, CASTE_OPTIONS,
} from "@/lib/import/fieldConstraints";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { getTeachingDesignations } from "@/lib/designations/config";
import type { Designation, EmploymentType, CollegeType } from "@/types";

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

type ImportRow = {
  employeeId: string;
  name: string;
  apaarFacultyId?: string;
  collegeEmail: string;
  phone?: string;
  password?: string;
  designation: string;
  qualification: string;
  specialization?: string;
  experienceYears?: string;
  employmentType: string;
  joiningDate: string;
  dateOfJoiningDepartment?: string;
  // Personal / statutory details
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
  subCaste?: string;
  ratificationStatus?: string;
  ratificationDate?: string;
  maritalStatus?: string;
  spouseName?: string;
  numberOfChildren?: string;
  referral?: string;
  nativePlace?: string;
  bloodGroup?: string;
  temporaryAddress?: string;
  permanentSameAsTemporary?: string;
  permanentAddress?: string;
};

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

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as { records: ImportRow[]; department?: string };

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
    const scope = await getHodDepartmentScope(db, collegeId, session.uid);
    let hodDept = body.department?.trim() ?? "";
    if (hodDept && !scope.ownDepartmentNames.includes(hodDept)) {
      return NextResponse.json({ error: "That department is not yours" }, { status: 403 });
    }
    if (!hodDept && scope.ownDepartmentNames.length > 1) {
      return NextResponse.json(
        { error: "You manage more than one department - choose which department this import belongs to" },
        { status: 400 }
      );
    }
    if (!hodDept) hodDept = scope.ownDepartmentNames[0] ?? "";
    if (!hodDept) {
      return NextResponse.json({ error: "Your account has no department set - ask your Principal to assign one before importing faculty" }, { status: 400 });
    }

    // Load existing employeeIds/collegeEmails to detect duplicates - lowercased,
    // since "VIT001"/"vit001" or two different casings of the same email are
    // the same real-world identifier and Firestore would otherwise let both
    // through as separate documents. employeeId is checked across every
    // college, not just this one - the public faculty-profile link is keyed
    // on employeeId alone (see /api/public/faculty-public), so a collision
    // between colleges would let one person's link resolve to a different
    // person's profile.
    // ponytail: full collectionGroup scan on every import, not an indexed
    // per-ID lookup - fine at hundreds of faculty across all colleges,
    // revisit (e.g. a global employeeId registry doc) if that grows to
    // thousands and imports start feeling slow.
    const [facultyEmailSnap, employeeIdSnap, collegeDocSnap] = await Promise.all([
      db.collection("colleges").doc(collegeId).collection("facultyMembers").select("collegeEmail").get(),
      db.collectionGroup("facultyMembers").select("employeeId").get(),
      db.collection("colleges").doc(collegeId).get(),
    ]);
    const existingIds = new Set(
      employeeIdSnap.docs.map((d) => (d.data() as { employeeId?: string }).employeeId?.toLowerCase()).filter((v): v is string => !!v)
    );
    const existingEmails = new Set(
      facultyEmailSnap.docs.map((d) => (d.data() as { collegeEmail?: string }).collegeEmail?.toLowerCase()).filter((v): v is string => !!v)
    );

    // The designation catalogue this college's Faculty template allows - the
    // same per-college-type list the manual Add/Edit form's dropdown offers
    // (src/lib/designations/config.ts), plus the always-available "Other".
    const collegeType = (collegeDocSnap.data() as { type?: CollegeType } | undefined)?.type;
    const allowedTeachingDesignations = getTeachingDesignations(collegeType);

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
      // A value that breaks its column's stated constraint rejects the whole
      // row. Importing the record with that one field quietly missing left a
      // half-correct faculty member on the list with nothing to show which
      // cell had been discarded; the row is skipped instead and offered back
      // for correction.
      const rowErrors: string[] = [];
      const dropped = (_empId: string, label: string, raw: string | undefined) => {
        rowErrors.push(`${label}: invalid value ("${raw?.trim()}")`);
      };

      // Required field validation
      if (!row.employeeId?.trim()) { failed.push({ row: rowNum, employeeId: "-", error: "Employee ID is required" }); continue; }
      if (!row.name?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Full Name is required" }); continue; }
      if (!row.collegeEmail?.trim() || !row.collegeEmail.includes("@")) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Valid College Email is required" }); continue; }
      if (!row.joiningDate?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Date of Joining Institution is required" }); continue; }
      if (!row.designation?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Designation is required" }); continue; }

      const empId = row.employeeId.trim();
      if (existingIds.has(empId.toLowerCase())) {
        failed.push({ row: rowNum, employeeId: empId, error: "Employee ID already exists" });
        continue;
      }
      const loginEmailKey = row.collegeEmail.trim().toLowerCase();
      if (existingEmails.has(loginEmailKey)) {
        failed.push({ row: rowNum, employeeId: empId, error: "College Email already belongs to another faculty member" });
        continue;
      }

      // Map designation - held to the template's own stated catalogue for
      // this college type (allowedTeachingDesignations), not free text.
      // DESIGNATION_MAP normalizes common Engineering-style abbreviations
      // ("Asst. Prof." -> "ASSISTANT_PROFESSOR") before checking membership,
      // so a value only counts if it's either a recognized abbreviation for
      // an allowed title, or already matches one of the allowed titles
      // directly (case/punctuation-insensitive) - e.g. "PGT" for a School
      // college. Anything else (including a Supporting Staff title like "Lab
      // Assistant", which belongs on that import instead) rejects the row
      // rather than being stored as whatever text was typed.
      const designationRaw = row.designation.trim();
      const designationKey = designationRaw.toLowerCase();
      let designation: Designation;
      if (designationKey === "other") {
        designation = "OTHER";
      } else {
        const mappedAbbreviation = DESIGNATION_MAP[designationKey];
        const matched = (mappedAbbreviation && allowedTeachingDesignations.includes(mappedAbbreviation))
          ? mappedAbbreviation
          : matchOption(designationRaw, allowedTeachingDesignations);
        if (!matched) {
          failed.push({
            row: rowNum, employeeId: empId,
            error: `Designation "${designationRaw}" is not one of the titles your college allows (${allowedTeachingDesignations.join(" / ")} / Other)`,
          });
          continue;
        }
        designation = matched;
      }

      // Map employment type - blank still takes the documented default; an
      // unrecognised value fails the row instead of quietly becoming
      // Permanent, which turned a typo into a real employment type (matches
      // the Supporting Staff importer's behavior).
      const empTypeKey = (row.employmentType ?? "").trim().toLowerCase();
      if (empTypeKey && !EMPLOYMENT_MAP[empTypeKey]) {
        failed.push({ row: rowNum, employeeId: empId, error: `Employment Type "${row.employmentType?.trim()}" is not one of Regular / Permanent / Contract / Visiting / Part-Time` });
        continue;
      }
      const employmentType: EmploymentType = EMPLOYMENT_MAP[empTypeKey] ?? "PERMANENT";

      // Parse dates
      const joiningDate = parseDate(row.joiningDate);
      if (!joiningDate) { failed.push({ row: rowNum, employeeId: empId, error: "Invalid Date of Joining Institution - use YYYY-MM-DD" }); continue; }
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

      const docRef = db.collection("colleges").doc(collegeId).collection("facultyMembers").doc();

      // Personal/statutory details - same shared shape the Add/Edit forms use.
      // Dates are run through the route's robust parseDate() and set directly;
      // the rest go through buildPersonalDetailsUpdate (string fields, PAN
      // uppercasing, number/boolean coercion).
      const dob = parseDate(row.dateOfBirth);
      if (row.dateOfBirth?.trim() && !dob) dropped(empId, "Date of Birth", row.dateOfBirth);
      const ratDate = parseDate(row.ratificationDate);
      if (row.ratificationDate?.trim() && !ratDate) dropped(empId, "Ratification Date", row.ratificationDate);
      // Each cell is held to the option set its template column states. A
      // value outside that set is dropped with a warning rather than stored -
      // "yes" in a Ratified / Not Ratified column is a guess about intent, and
      // storing it produced statuses the Add/Edit dropdowns can never show.
      const checkOption = (raw: string | undefined, options: readonly string[], label: string) => {
        if (!raw?.trim()) return undefined;
        const matched = matchOption(raw, options);
        if (!matched) dropped(empId, label, raw);
        return matched;
      };
      const checkYesNo = (raw: string | undefined, label: string) => {
        if (!raw?.trim()) return undefined;
        const parsed = parseYesNoStrict(raw);
        if (parsed === undefined) dropped(empId, label, raw);
        return parsed;
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

      const personalInput: PersonalDetailsInput = {
        gender: checkOption(row.gender, GENDER_OPTIONS, "Gender"),
        legalName: row.legalName?.trim() || undefined,
        fatherName: row.fatherName?.trim() || undefined,
        motherName: row.motherName?.trim() || undefined,
        aadharNo: normalizeDigits(row.aadharNo),
        panNo: row.panNo?.trim() || undefined,
        passportNumber: row.passportNumber?.trim() || undefined,
        emergencyContactName: row.emergencyContactName?.trim() || undefined,
        emergencyContactPhone: checkPhone(row.emergencyContactPhone, "Emergency Contact Phone"),
        religion: checkOption(row.religion, RELIGION_OPTIONS, "Religion"),
        caste: checkOption(row.caste, CASTE_OPTIONS, "Caste"),
        subCaste: row.subCaste?.trim() || undefined,
        ratificationStatus: checkOption(row.ratificationStatus, RATIFICATION_STATUS_OPTIONS, "Ratification Status"),
        maritalStatus: checkOption(row.maritalStatus, MARITAL_STATUS_OPTIONS, "Marital Status"),
        spouseName: row.spouseName?.trim() || undefined,
        numberOfChildren: checkNum(row.numberOfChildren, "Number of Children"),
        referral: row.referral?.trim() || undefined,
        nativePlace: row.nativePlace?.trim() || undefined,
        temporaryAddress: row.temporaryAddress?.trim() || undefined,
        permanentSameAsTemporary: checkYesNo(row.permanentSameAsTemporary, "Permanent Same as Temporary"),
        permanentAddress: row.permanentAddress?.trim() || undefined,
        bloodGroup: checkOption(row.bloodGroup, BLOOD_GROUP_OPTIONS, "Blood Group"),
      };

      // Computed above the gate, not inline in the payload literal below: that
      // literal is built after the gate, so an unparseable value here was
      // recorded too late to reject the row and silently became 0.
      const vExperienceYears = checkNum(row.experienceYears, "Years of Experience");

      // Every constraint the template states has now been checked. Anything
      // that failed one rejects the row here - before the login below, so a
      // skipped row can't leave an orphaned Firebase Auth account behind.
      if (rowErrors.length > 0) {
        failed.push({ row: rowNum, employeeId: empId, error: rowErrors.join("; ") });
        continue;
      }

      // Optional login creation - a CSV row with a Password fills in the
      // faculty member's login account (role: Panel Member) right here during
      // import, so there's no separate "Set Login" step needed afterward for
      // rows that came in this way. Rows left blank still fall back to the
      // per-faculty "Set Login" button on the Faculty list (its userUid check
      // there is what keeps that button hidden once this has run).
      let userUid: string | undefined;
      const passwordRaw = row.password?.trim();
      const loginEmail = loginEmailKey;
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


      const payload: Record<string, unknown> = {
        userUid,
        collegeId,
        department: hodDept,
        employeeId: empId,
        name: row.name.trim(),
        apaarFacultyId: row.apaarFacultyId?.trim() || undefined,
        collegeEmail: loginEmail,
        phone: checkPhone(row.phone, "Phone") ?? "",
        designation,
        qualification: row.qualification?.trim() ?? "",
        specialization: row.specialization?.trim() ?? "",
        employmentType,
        experienceYears: vExperienceYears ?? 0,
        joiningDate,
        dateOfJoiningDepartment: dateOfJoiningDepartment || undefined,
        status: "ACTIVE",
        ...buildPersonalDetailsUpdate(personalInput),
        ...(dob ? { dateOfBirth: dob } : {}),
        ...(ratDate ? { ratificationDate: ratDate } : {}),
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

      existingIds.add(empId.toLowerCase()); // prevent duplicates within the same batch
      existingEmails.add(loginEmailKey);
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
