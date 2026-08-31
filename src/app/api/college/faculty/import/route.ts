export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import type { Designation, EmploymentType } from "@/types";

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
    const [collegeSnap, employeeIdSnap] = await Promise.all([
      db.collection("colleges").doc(collegeId).collection("facultyMembers").select("collegeEmail").get(),
      db.collectionGroup("facultyMembers").select("employeeId").get(),
    ]);
    const existingIds = new Set(
      employeeIdSnap.docs.map((d) => (d.data() as { employeeId?: string }).employeeId?.toLowerCase()).filter((v): v is string => !!v)
    );
    const existingEmails = new Set(
      collegeSnap.docs.map((d) => (d.data() as { collegeEmail?: string }).collegeEmail?.toLowerCase()).filter((v): v is string => !!v)
    );

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

      // Map designation - free text (see src/lib/designations/config.ts),
      // since it varies by the college's type. DESIGNATION_MAP only
      // normalizes common Engineering-style abbreviations ("Asst. Prof." ->
      // "ASSISTANT_PROFESSOR", the legacy code every existing Engineering/
      // Pharmacy/Dental record and the AICTE cadre-ratio report expect) -
      // anything else (e.g. "PGT", "Controller of Examinations") is stored
      // exactly as typed rather than being forced into that list or
      // defaulted to a designation the row never actually specified.
      const designationKey = row.designation.trim().toLowerCase();
      const designation: Designation = DESIGNATION_MAP[designationKey] ?? row.designation.trim();

      // Map employment type
      const empTypeKey = (row.employmentType ?? "").trim().toLowerCase();
      const employmentType: EmploymentType = EMPLOYMENT_MAP[empTypeKey] ?? "PERMANENT";
      if (empTypeKey && !EMPLOYMENT_MAP[empTypeKey]) {
        warnings.push({ row: rowNum, employeeId: empId, warning: `Employment Type not recognized ("${row.employmentType?.trim()}") - defaulted to Permanent` });
      }

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

      const docRef = db.collection("colleges").doc(collegeId).collection("facultyMembers").doc();

      // Personal/statutory details - same shared shape the Add/Edit forms use.
      // Dates are run through the route's robust parseDate() and set directly;
      // the rest go through buildPersonalDetailsUpdate (string fields, PAN
      // uppercasing, number/boolean coercion).
      const dob = parseDate(row.dateOfBirth);
      if (row.dateOfBirth?.trim() && !dob) dropped(empId, "Date of Birth", row.dateOfBirth);
      const ratDate = parseDate(row.ratificationDate);
      if (row.ratificationDate?.trim() && !ratDate) dropped(empId, "Ratification Date", row.ratificationDate);
      const personalInput: PersonalDetailsInput = {
        gender: row.gender?.trim() || undefined,
        legalName: row.legalName?.trim() || undefined,
        fatherName: row.fatherName?.trim() || undefined,
        motherName: row.motherName?.trim() || undefined,
        aadharNo: row.aadharNo?.trim() || undefined,
        panNo: row.panNo?.trim() || undefined,
        passportNumber: row.passportNumber?.trim() || undefined,
        emergencyContactName: row.emergencyContactName?.trim() || undefined,
        emergencyContactPhone: row.emergencyContactPhone?.trim() || undefined,
        religion: row.religion?.trim() || undefined,
        caste: row.caste?.trim() || undefined,
        subCaste: row.subCaste?.trim() || undefined,
        ratificationStatus: row.ratificationStatus?.trim() || undefined,
        maritalStatus: row.maritalStatus?.trim() || undefined,
        spouseName: row.spouseName?.trim() || undefined,
        numberOfChildren: checkNum(row.numberOfChildren, "Number of Children"),
        referral: row.referral?.trim() || undefined,
        nativePlace: row.nativePlace?.trim() || undefined,
        temporaryAddress: row.temporaryAddress?.trim() || undefined,
        permanentSameAsTemporary: row.permanentSameAsTemporary
          ? row.permanentSameAsTemporary.trim().toLowerCase() === "yes"
          : undefined,
        permanentAddress: row.permanentAddress?.trim() || undefined,
        bloodGroup: row.bloodGroup?.trim() || undefined,
      };

      const payload: Record<string, unknown> = {
        userUid,
        collegeId,
        department: hodDept,
        employeeId: empId,
        name: row.name.trim(),
        apaarFacultyId: row.apaarFacultyId?.trim() || undefined,
        collegeEmail: loginEmail,
        phone: row.phone?.trim() ?? "",
        designation,
        qualification: row.qualification?.trim() ?? "",
        specialization: row.specialization?.trim() ?? "",
        employmentType,
        experienceYears: checkNum(row.experienceYears, "Years of Experience") ?? 0,
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
