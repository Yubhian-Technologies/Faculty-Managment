export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { ChunkedBatch, ChunkedBatchError } from "@/lib/firestore/chunkedBatch";
import {
  matchOption, normalizeDigits, isScientificNotation,
  GENDER_OPTIONS, RATIFICATION_STATUS_OPTIONS,
} from "@/lib/import/fieldConstraints";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { FACULTY_DESIGNATIONS, FACULTY_EMPLOYMENT_CATEGORIES, designationLabel } from "@/lib/designations/config";
import type { Designation, EmploymentType } from "@/types";

// Abbreviations for FACULTY_DESIGNATIONS (src/lib/designations/config.ts) -
// stores the same PROFESSOR/ASSOCIATE_PROFESSOR/ASSISTANT_PROFESSOR codes the
// rest of the app (and AICTE cadre-ratio counting) already uses for those
// three ranks; the new titles get their own codes, matched by their full
// (case-insensitive) name since they have no common abbreviation.
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
  "visiting professor": "VISITING_PROFESSOR",
  "assistant professor of practice": "ASSISTANT_PROFESSOR_OF_PRACTICE",
  "asst. prof. of practice": "ASSISTANT_PROFESSOR_OF_PRACTICE",
  "asst prof of practice": "ASSISTANT_PROFESSOR_OF_PRACTICE",
  "sr. wellness counsellor": "SR_WELLNESS_COUNSELLOR",
  "sr wellness counsellor": "SR_WELLNESS_COUNSELLOR",
  "senior wellness counsellor": "SR_WELLNESS_COUNSELLOR",
  "other": "OTHER",
};

// FACULTY_EMPLOYMENT_CATEGORIES values, stored verbatim (no code lookup
// needed - unlike Designation, nothing else in the app matches on
// employmentType's literal value). "Other" is accepted here too so an
// imported row can hold it as-is; there's no companion "specify" column on
// the template - the custom detail is filled in later from the Add/Edit form.
const EMPLOYMENT_MAP: Record<string, EmploymentType> = Object.fromEntries(
  FACULTY_EMPLOYMENT_CATEGORIES.map((c) => [c.toLowerCase(), c])
);
EMPLOYMENT_MAP["other"] = "Other";
EMPLOYMENT_MAP["regular (hyd)"] = "Regular(Hyd)";

type ImportRow = {
  employeeId: string;
  legalName: string;
  name: string;
  collegeEmail: string;
  password: string;
  phone: string;
  designation: string;
  qualification: string;
  employmentType: string;
  joiningDate: string;
  gender: string;
  dateOfBirth: string;
  nameAsPerAadhar?: string;
  aadharNo: string;
  panNo: string;
  ratificationStatus: string;
};

// Accepts the template's DD-MM-YYYY format (DD/MM/YYYY too - what Excel
// re-saves a date cell as under an Indian locale), and still falls back to
// the older YYYY-MM-DD format so sheets built against a previous version of
// the template keep importing - otherwise a malformed string silently
// becomes a JS "Invalid Date" object that isn't caught by any `undefined`
// check and throws when Firestore serializes it, failing the entire batch
// instead of just this row.
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
    const [facultyEmailSnap, employeeIdSnap] = await Promise.all([
      db.collection("colleges").doc(collegeId).collection("facultyMembers").select("collegeEmail").get(),
      db.collectionGroup("facultyMembers").select("employeeId").get(),
    ]);
    const existingIds = new Set(
      employeeIdSnap.docs.map((d) => (d.data() as { employeeId?: string }).employeeId?.toLowerCase()).filter((v): v is string => !!v)
    );
    const existingEmails = new Set(
      facultyEmailSnap.docs.map((d) => (d.data() as { collegeEmail?: string }).collegeEmail?.toLowerCase()).filter((v): v is string => !!v)
    );

    // The designation catalogue this college's Faculty template allows - the
    // same fixed list the manual Add form's dropdown offers
    // (FACULTY_DESIGNATIONS, src/lib/designations/config.ts), plus the
    // always-available "Other".
    const allowedTeachingDesignations = FACULTY_DESIGNATIONS;

    const now = new Date();
    // Rows that passed validation and were queued for write, alongside which
    // ChunkedBatch chunk their writes landed in - kept separate from `created`
    // (the actually-confirmed list returned to the caller) so a chunk that
    // fails to commit can be reclassified as failed instead of being reported
    // as created when it never durably landed.
    const queuedRows: { row: number; employeeId: string; chunkIndex: number }[] = [];
    const created: string[] = [];
    const failed: { row: number; employeeId: string; error: string }[] = [];
    const warnings: { row: number; employeeId: string; warning: string }[] = [];
    // Firebase Auth accounts created mid-loop for rows with a Password
    // column - tracked separately because they're created one row at a time
    // (outside Firestore's batch/transaction model). Grouped by which
    // ChunkedBatch chunk each row's Firestore writes landed in: a large
    // import spans multiple independently-committed chunks (not one atomic
    // write), so if a later chunk's commit fails, only the Auth accounts
    // belonging to the chunks that actually failed get torn down - accounts
    // tied to an earlier, already-committed chunk must NOT be deleted, or
    // those rows are left with a Firestore login doc pointing at a
    // just-deleted Auth account (a locked-out login the UI can't detect or
    // repair, with re-import blocked by the now-existing employeeId/email).
    const authUidsByChunk: string[][] = [[]];

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

      // Required field validation - every column in the trimmed-down template
      // (src/lib/faculty/csvColumns.ts IMPORT_COLUMNS) is mandatory.
      if (!row.employeeId?.trim()) { failed.push({ row: rowNum, employeeId: "-", error: "Employee ID is required" }); continue; }
      if (!row.legalName?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Full Name (as per SSC) is required" }); continue; }
      if (!row.name?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Name (as per PAN) is required" }); continue; }
      if (!row.collegeEmail?.trim() || !row.collegeEmail.includes("@")) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Valid College Email is required" }); continue; }
      if (!row.password?.trim() || row.password.trim().length < 8) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Login Password is required and must be at least 8 characters" }); continue; }
      if (!row.phone?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Mobile No is required" }); continue; }
      if (!row.designation?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Designation is required" }); continue; }
      if (!row.qualification?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Highest Qualification is required" }); continue; }
      if (!row.employmentType?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Employee Category is required" }); continue; }
      if (!row.joiningDate?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Date of Joining Institution is required" }); continue; }
      if (!row.gender?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Gender is required" }); continue; }
      if (!row.dateOfBirth?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Date of Birth is required" }); continue; }
      if (!row.aadharNo?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Aadhar No is required" }); continue; }
      if (!row.panNo?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "PAN No is required" }); continue; }
      if (!row.ratificationStatus?.trim()) { failed.push({ row: rowNum, employeeId: row.employeeId, error: "Ratification Status is required" }); continue; }

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

      // Map designation - held to FACULTY_DESIGNATIONS, not free text.
      // DESIGNATION_MAP normalizes common abbreviations ("Asst. Prof." ->
      // "ASSISTANT_PROFESSOR") before checking membership, so a value only
      // counts if it's either a recognized abbreviation for an allowed
      // title, or already matches one of the allowed titles directly (case/
      // punctuation-insensitive). Anything else rejects the row rather than
      // being stored as whatever text was typed.
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
            error: `Designation "${designationRaw}" is not one of the titles your college allows (${allowedTeachingDesignations.map((d) => designationLabel(d)).join(" / ")} / Other)`,
          });
          continue;
        }
        designation = matched;
      }

      // Map employment type - held to FACULTY_EMPLOYMENT_CATEGORIES
      // (+ "Other", no companion "specify" column needed on the template -
      // see EMPLOYMENT_MAP's own comment above); an unrecognised value fails
      // the row rather than quietly becoming a default, which would turn a
      // typo into a real employment category.
      const empTypeKey = row.employmentType.trim().toLowerCase();
      if (!EMPLOYMENT_MAP[empTypeKey]) {
        failed.push({ row: rowNum, employeeId: empId, error: `Employee Category "${row.employmentType.trim()}" is not one of ${FACULTY_EMPLOYMENT_CATEGORIES.join(" / ")} / Other` });
        continue;
      }
      const employmentType: EmploymentType = EMPLOYMENT_MAP[empTypeKey];

      // Parse dates
      const joiningDate = parseDate(row.joiningDate);
      if (!joiningDate) { failed.push({ row: rowNum, employeeId: empId, error: "Invalid Date of Joining Institution - use DD-MM-YYYY" }); continue; }

      const docRef = db.collection("colleges").doc(collegeId).collection("facultyMembers").doc();

      // Personal/statutory details - same shared shape the Add/Edit forms use.
      // dateOfBirth is run through the route's robust parseDate() and set
      // directly; the rest go through buildPersonalDetailsUpdate (string
      // fields, PAN uppercasing).
      const dob = parseDate(row.dateOfBirth);
      if (!dob) dropped(empId, "Date of Birth", row.dateOfBirth);
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
        legalName: row.legalName.trim(),
        nameAsPerAadhar: row.nameAsPerAadhar?.trim() || undefined,
        aadharNo: normalizeDigits(row.aadharNo),
        panNo: row.panNo.trim(),
        ratificationStatus: checkOption(row.ratificationStatus, RATIFICATION_STATUS_OPTIONS, "Ratification Status"),
      };

      // Every constraint the template states has now been checked. Anything
      // that failed one rejects the row here - before the login below, so a
      // skipped row can't leave an orphaned Firebase Auth account behind.
      if (rowErrors.length > 0) {
        failed.push({ row: rowNum, employeeId: empId, error: rowErrors.join("; ") });
        continue;
      }

      // Login creation - mandatory now that Login Password is a required
      // column, so every imported row gets a login account (role: Panel
      // Member) immediately, no separate "Set Login" step needed afterward.
      // A failure here (e.g. the email is already registered to some other
      // Auth account) rejects the whole row for correction, same as every
      // other constraint above - it can't leave a faculty record behind with
      // no way to log in.
      const passwordRaw = row.password.trim();
      const loginEmail = loginEmailKey;
      let userUid: string;
      try {
        userUid = await createFirebaseUser(loginEmail, passwordRaw, row.name.trim());
      } catch (err) {
        const message = err && typeof err === "object" && "code" in err && err.code === "auth/email-already-exists"
          ? "an account with this email already exists"
          : err instanceof Error ? err.message : "unknown error";
        failed.push({ row: rowNum, employeeId: empId, error: `Login not created - ${message}` });
        continue;
      }

      const payload: Record<string, unknown> = {
        userUid,
        collegeId,
        department: hodDept,
        employeeId: empId,
        name: row.name.trim(),
        collegeEmail: loginEmail,
        phone: checkPhone(row.phone, "Phone") ?? "",
        designation,
        qualification: row.qualification.trim(),
        employmentType,
        joiningDate,
        status: "ACTIVE",
        ...buildPersonalDetailsUpdate(personalInput),
        ...(dob ? { dateOfBirth: dob } : {}),
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

      // Record which chunk this row's writes just landed in (after all of
      // this row's batch.set() calls, so a rotation that happened mid-row is
      // reflected) - used below to roll back only the Auth accounts and
      // report only the rows belonging to a chunk that actually fails to
      // commit, instead of treating the whole request as all-or-nothing.
      const chunkIndex = batch.getCurrentChunkIndex();
      while (authUidsByChunk.length <= chunkIndex) authUidsByChunk.push([]);
      if (userUid) authUidsByChunk[chunkIndex].push(userUid);
      queuedRows.push({ row: rowNum, employeeId: empId, chunkIndex });

      existingIds.add(empId.toLowerCase()); // prevent duplicates within the same batch
      existingEmails.add(loginEmailKey);
    }

    let failedChunkIndexes: number[] = [];
    try {
      await batch.commit();
    } catch (commitErr) {
      if (!(commitErr instanceof ChunkedBatchError)) {
        // Unexpected error shape (never actually reached commit()'s own
        // per-chunk accounting) - can't tell which chunks are safe, so roll
        // every Auth account back, same as the previous all-or-nothing
        // behavior, and surface a hard failure.
        if (authUidsByChunk.flat().length > 0) {
          const { getAdminAuth } = await import("@/lib/firebase/admin");
          const auth = await getAdminAuth();
          await Promise.all(authUidsByChunk.flat().map((uid) =>
            auth.deleteUser(uid).catch((cleanupErr) =>
              console.error(`[faculty/import POST] Failed to roll back orphaned Auth user ${uid}:`, cleanupErr)
            )
          ));
        }
        throw commitErr;
      }
      // Only the chunk(s) that actually failed to commit are rolled back -
      // rows in an earlier, already-committed chunk keep their real Firestore
      // docs (and working logins) and must not be touched.
      failedChunkIndexes = commitErr.failedChunkIndexes;
      const uidsToRollBack = failedChunkIndexes.flatMap((i) => authUidsByChunk[i] ?? []);
      if (uidsToRollBack.length > 0) {
        const { getAdminAuth } = await import("@/lib/firebase/admin");
        const auth = await getAdminAuth();
        await Promise.all(uidsToRollBack.map((uid) =>
          auth.deleteUser(uid).catch((cleanupErr) =>
            console.error(`[faculty/import POST] Failed to roll back orphaned Auth user ${uid}:`, cleanupErr)
          )
        ));
      }
    }

    // Reconcile queued rows against which chunk actually committed - a row
    // whose writes landed in a failed chunk never durably saved, so it's
    // reported as failed (safe to retry) rather than created; every other
    // queued row's chunk committed, so it's confirmed created.
    const failedChunkSet = new Set(failedChunkIndexes);
    for (const q of queuedRows) {
      if (failedChunkSet.has(q.chunkIndex)) {
        failed.push({ row: q.row, employeeId: q.employeeId, error: "Save failed for this batch of rows - retry this row" });
      } else {
        created.push(q.employeeId);
      }
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
