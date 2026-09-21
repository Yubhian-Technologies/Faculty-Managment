export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodManageFacultyDepartment } from "@/lib/departments/scope";
import { syncTrainingEntryCoConductors } from "@/lib/faculty/syncTrainingEntryCoConductors";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import { experienceBreakdown, allPreviousExperienceEntries } from "@/lib/faculty/experienceCalc";
import { normalizeAcademicProfile } from "@/lib/faculty/academicProfileCompat";
import { degreeTypeError } from "@/lib/faculty/degreeType";
import {
  academicProfileFirestoreUpdates, applyAcademicProfileChanges, parseAcademicProfileChanges, touchesTrainingEntries,
  type AcademicProfileChanges,
} from "@/lib/faculty/academicProfileChanges";
import { migrateFacultyDoc } from "@/lib/faculty/fieldRenames";
import { withLegacyFacultyKeysDeleted } from "@/lib/faculty/legacyKeyDeletes";
import { mobileNoFromBody } from "@/lib/faculty/mobileNo";
import { normalizeHighestQualification } from "@/lib/faculty/highestQualification";
import { FieldValue } from "firebase-admin/firestore";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import type { Designation, EmployeeCategory, FacultyStatus, TrainingEntry } from "@/types";
import { EMPLOYEE_CATEGORY_VALUES, EMPLOYEE_CATEGORY_ERROR_MESSAGE } from "@/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("facultyMembers")
      .doc(id)
      .get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // An HOD may only view faculty within their own scope - their own
    // department and its true sub-departments, never a managed/"core"
    // branch (see canHodManageFacultyDepartment's own doc-comment).
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      const facultyDept = (snap.data() as { department?: string }).department ?? "";
      if (!canHodManageFacultyDepartment(scope, facultyDept)) {
        return NextResponse.json({ error: "That faculty member is outside your department scope" }, { status: 403 });
      }
    }

    return NextResponse.json({ faculty: { id: snap.id, ...migrateFacultyDoc(snap.data() ?? {}) } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const { id } = await params;

    const body = (await request.json()) as Partial<{
      employeeId: string;
      apaarFacultyId: string;
      email: string;
      mobileNo: string;
      phone: string; // legacy alias of mobileNo, accepted for one release (see mobileNoFromBody)
      additionalPhoneNumbers: { label?: string; number: string }[];
      collegeEmail: string;
      designation: Designation;
      highestQualification: string;
      specialization: string;
      joiningDate: string;
      employeeCategory: EmployeeCategory;
      aicteFacultyId: string;
      status: FacultyStatus;
      userUid: string;
      academicProfile: Record<string, unknown>;
      // Section-scoped alternative to `academicProfile`: only the keys that changed
      // ({ set, remove }) - see academicProfileChanges.ts. Never combined with it.
      academicProfileChanges: unknown;
      technicalProfile: Record<string, unknown>;
      profilePhotoUrl: string;
      joiningLetterUrl: string;
      appointmentLetterUrl: string;
      resumeUrl: string;
    }> &
      PersonalDetailsInput;

    const legacyMobileNo = mobileNoFromBody(body);
    if (legacyMobileNo !== undefined) body.mobileNo = legacyMobileNo;

    const db = getAdminDb();
    const ref = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("facultyMembers")
      .doc(id);

    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      const facultyDept = (snap.data() as { department?: string }).department ?? "";
      if (!canHodManageFacultyDepartment(scope, facultyDept)) {
        return NextResponse.json({ error: "That faculty member is outside your department scope" }, { status: 403 });
      }
    }

    // Empty string clears the photo - everything else must be a real upload of ours.
    if (
      body.profilePhotoUrl !== undefined &&
      body.profilePhotoUrl !== "" &&
      (!body.profilePhotoUrl.startsWith("https://firebasestorage.googleapis.com/") ||
        !body.profilePhotoUrl.includes(encodeURIComponent(`profile-photos/${id}_`)))
    ) {
      return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
    }

    // These fields are mandatory on both the import template and Add Faculty
    // wizard - Edit must not be able to blank one out via a partial PATCH
    // that explicitly sends an empty string for it (a field simply left out
    // of the body is untouched, which is fine). `nameAsPerPan` (Name as per
    // PAN) is deliberately NOT in this list - it's optional; legalName (Full
    // Name as per SSC) is the required, only identity/display name.
    const REQUIRED_IF_PRESENT = [
      "collegeEmail", "mobileNo", "designation", "highestQualification",
      "gender", "legalName", "aadharNo", "panNo", "ratificationStatus",
    ] as const;
    for (const key of REQUIRED_IF_PRESENT) {
      if (body[key] !== undefined && !body[key].trim()) {
        return NextResponse.json({ error: `${key} cannot be blanked out - it is a required field` }, { status: 400 });
      }
    }
    // Only the EMPLOYEE_CATEGORY_VALUES keys are accepted anywhere Employee
    // Category is set - see EmployeeCategory's doc-comment in types/core.ts.
    if (body.employeeCategory !== undefined && !EMPLOYEE_CATEGORY_VALUES.includes(body.employeeCategory)) {
      return NextResponse.json({ error: EMPLOYEE_CATEGORY_ERROR_MESSAGE }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    // Employee ID must stay unique across every college, not just this one -
    // checked separately from the other string fields since it needs a
    // duplicate lookup (mirrors the check on creation in POST /api/college/faculty).
    // Cross-college because the public faculty-profile link is keyed on
    // employeeId alone (see /api/public/faculty-public).
    if (body.employeeId !== undefined && body.employeeId.trim()) {
      const newEmployeeId = body.employeeId.trim();
      const currentEmployeeId = (snap.data() as { employeeId?: string }).employeeId;
      if (newEmployeeId !== currentEmployeeId) {
        const dupSnap = await db
          .collectionGroup("facultyMembers")
          .where("employeeId", "==", newEmployeeId)
          .limit(1)
          .get();
        if (!dupSnap.empty) {
          return NextResponse.json({ error: "Employee ID already exists" }, { status: 409 });
        }
      }
      updates.employeeId = newEmployeeId;
    }

    // Personal/statutory details (gender, name variants, bank, address, PF
    // number, mother tongue, languages known, height/weight, etc.) - shared
    // builder also used by the create route (POST /api/college/faculty), so
    // an edit persists exactly the fields creation does instead of a second,
    // easily-incomplete hand-rolled whitelist (a prior version of this route
    // omitted pfNumber/motherTongue/languagesKnown/heightFeet/heightInches/
    // weightKg entirely, so those silently failed to save on edit).
    Object.assign(updates, buildPersonalDetailsUpdate(body));

    // Non-personal string fields
    const stringFields = [
      "email", "mobileNo", "collegeEmail", "apaarFacultyId", "aicteFacultyId", "designation", "highestQualification",
      "specialization", "employeeCategory", "status", "userUid",
    ] as const;

    for (const key of stringFields) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    // One category per faculty member, whatever spelling/casing the caller sent.
    if (typeof updates.highestQualification === "string") {
      updates.highestQualification = normalizeHighestQualification(updates.highestQualification);
    }

    // Extra contact numbers beyond the primary Mobile No - cleaned/filtered
    // the same way the create route does. Writing [] (not omitting the key)
    // is how a caller clears every extra number back out.
    if (body.additionalPhoneNumbers !== undefined) {
      updates.additionalPhoneNumbers = body.additionalPhoneNumbers
        .map((p) => ({ ...(p.label?.trim() ? { label: p.label.trim() } : {}), number: p.number?.trim() ?? "" }))
        .filter((p) => p.number);
    }

    // Academic profile (Modules 1-5) / Technical profile - mutually exclusive by designation.
    // The edit pages send `academicProfileChanges` (only the keys the tab changed), written
    // as dot-paths so every other key of the stored profile is left exactly as it is;
    // `academicProfile` (the whole object) is still accepted and replaces it wholesale.
    let academicChanges: AcademicProfileChanges | undefined;
    if (body.academicProfileChanges !== undefined) {
      if (body.academicProfile !== undefined) {
        return NextResponse.json({ error: "Send either academicProfile or academicProfileChanges, not both" }, { status: 400 });
      }
      const parsed = parseAcademicProfileChanges(body.academicProfileChanges);
      if (!parsed) return NextResponse.json({ error: "Invalid academicProfileChanges" }, { status: 400 });
      const degreeErr = degreeTypeError(parsed.set);
      if (degreeErr) return NextResponse.json({ error: degreeErr }, { status: 400 });
      academicChanges = parsed;
      Object.assign(updates, academicProfileFirestoreUpdates((snap.data() as { academicProfile?: unknown }).academicProfile, academicChanges, FieldValue.delete()));
    } else if (body.academicProfile !== undefined) {
      const degreeErr = degreeTypeError(body.academicProfile);
      if (degreeErr) return NextResponse.json({ error: degreeErr }, { status: 400 });
      updates.academicProfile = normalizeAcademicProfile(body.academicProfile);
    }
    if (body.technicalProfile !== undefined) updates.technicalProfile = body.technicalProfile;

    // Date fields
    if (body.joiningDate) updates.joiningDate = new Date(body.joiningDate);

    // Total Years of Experience (Internal since Date of Joining + External
    // from the Academic/Industry/Research Experience entries) - always
    // recomputed here server-side, never taken from the client, so it can't
    // drift from what Faculty Details/the Faculty List compute live from the
    // same two inputs. Only recomputed when this PATCH actually touches one
    // of those inputs; whichever of academicProfile/joiningDate it doesn't
    // touch falls back to what's already on the doc.
    if (body.academicProfile !== undefined || academicChanges || body.joiningDate) {
      const existing = snap.data() as { academicProfile?: Record<string, unknown>; joiningDate?: FirebaseFirestore.Timestamp };
      const effectiveAcademicProfile = academicChanges
        ? applyAcademicProfileChanges(existing.academicProfile, academicChanges)
        : body.academicProfile !== undefined ? updates.academicProfile : normalizeAcademicProfile(existing.academicProfile);
      const effectiveJoiningDate = body.joiningDate ? new Date(body.joiningDate) : existing.joiningDate;
      updates.totalYearsOfExperience = experienceBreakdown(
        allPreviousExperienceEntries(effectiveAcademicProfile as Parameters<typeof allPreviousExperienceEntries>[0]),
        effectiveJoiningDate
      ).total;
    }

    if (body.profilePhotoUrl !== undefined) updates.profilePhotoUrl = body.profilePhotoUrl;

    // Letter/resume URL fields - validate they are Firebase Storage URLs or empty (clear)
    for (const field of ["joiningLetterUrl", "appointmentLetterUrl", "resumeUrl"] as const) {
      if (body[field] !== undefined) {
        if (body[field] !== "" && !body[field].startsWith("https://firebasestorage.googleapis.com/")) {
          return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });
        }
        updates[field] = body[field];
      }
    }

    // A doc not yet migrated may still hold the old-named twin of a key written
    // above (qualification, experienceYears, passportNumber, ...) - drop it so
    // the doc never carries both.
    await ref.update(withLegacyFacultyKeysDeleted(updates, FieldValue.delete()));

    // The record's display name is legalName only (facultyDisplayName()) -
    // Name (as per PAN) never feeds it. Recomputed from the POST-update value
    // (this PATCH's legalName, falling back to what was already on the doc) so
    // a rename is detected and propagated correctly.
    const before = snap.data() as { legalName?: string; userUid?: string };
    const newDisplayName = facultyDisplayName({ legalName: body.legalName !== undefined ? body.legalName : before.legalName });
    const oldDisplayName = facultyDisplayName(before);
    const displayNameChanged = body.legalName !== undefined && newDisplayName !== oldDisplayName;

    // Best-effort: if this faculty record has a linked system login, keep their
    // name/photo in sync there too - the login doc (colleges/{id}/users) is what
    // panel-member pickers, notifications, and the nav/avatar read from, so edits
    // made here on the faculty details page must propagate or those surfaces show
    // stale data from account creation time.
    if (body.profilePhotoUrl !== undefined || displayNameChanged) {
      const linkedUid = before.userUid;
      if (linkedUid) {
        const loginSync: Record<string, string> = {};
        if (body.profilePhotoUrl !== undefined) loginSync.profilePhotoUrl = body.profilePhotoUrl;
        if (displayNameChanged) loginSync.name = newDisplayName;
        try {
          await db.collection("colleges").doc(session.collegeId).collection("users").doc(linkedUid)
            .set(loginSync, { merge: true });
          await db.collection("systemUsers").doc(linkedUid)
            .set(loginSync, { merge: true });
        } catch { /* non-fatal */ }
      }
    }

    // A faculty's display name is copied into teachingAssignments/timetableSlots/
    // Section at assignment/incharge-set time and never re-read afterward - a
    // rename here must be cascaded into every one of those copies or they show
    // the old name forever. Historical Tier-2 records (attendance, marks,
    // payroll, etc.) are deliberately NOT touched - those are point-in-time
    // snapshots, not live state.
    if (displayNameChanged) {
      try {
        const newName = newDisplayName;
        const collegeRef = db.collection("colleges").doc(session.collegeId);
        const now = new Date();

        const [assignmentsSnap, slotsSnap] = await Promise.all([
          collegeRef.collection("teachingAssignments").where("facultyId", "==", id).get(),
          collegeRef.collection("timetableSlots").where("facultyId", "==", id).get(),
        ]);
        for (const [snapshot, field] of [[assignmentsSnap, "facultyName"], [slotsSnap, "facultyName"]] as const) {
          for (let i = 0; i < snapshot.docs.length; i += 400) {
            const chunk = snapshot.docs.slice(i, i + 400);
            const chunkBatch = db.batch();
            for (const doc of chunk) chunkBatch.update(doc.ref, { [field]: newName, updatedAt: now });
            await chunkBatch.commit();
          }
        }

        // Section.facultyInchargeUid holds either this faculty's linked login
        // uid (the form new writes use) or - on some older records - the
        // FacultyMember doc id itself (see getFacultyIdCandidates's own
        // doc-comment); match both so a section set up under either form
        // still gets its facultyInchargeName kept in sync.
        const linkedUid = before.userUid;
        const inchargeCandidates = linkedUid && linkedUid !== id ? [linkedUid, id] : [id];
        const sectionsSnap = await collegeRef.collection("sections").where("facultyInchargeUid", "in", inchargeCandidates).get();
        for (let i = 0; i < sectionsSnap.docs.length; i += 400) {
          const chunk = sectionsSnap.docs.slice(i, i + 400);
          const chunkBatch = db.batch();
          for (const doc of chunk) chunkBatch.update(doc.ref, { facultyInchargeName: newName, updatedAt: now });
          await chunkBatch.commit();
        }
      } catch (cascadeErr) {
        console.error("[college/faculty/[id] PATCH] facultyName cascade failed:", cascadeErr);
      }
    }

    if (body.academicProfile !== undefined || (academicChanges && touchesTrainingEntries(academicChanges))) {
      try {
        const storedProfile = (snap.data() as { academicProfile?: { fdpsWorkshopsMoocsCertifications?: TrainingEntry[] } }).academicProfile;
        const previousEntries = normalizeAcademicProfile(storedProfile)?.fdpsWorkshopsMoocsCertifications;
        const nextEntries = academicChanges
          ? (applyAcademicProfileChanges(storedProfile, academicChanges) as { fdpsWorkshopsMoocsCertifications?: TrainingEntry[] }).fdpsWorkshopsMoocsCertifications
          : (updates.academicProfile as { fdpsWorkshopsMoocsCertifications?: TrainingEntry[] } | undefined)?.fdpsWorkshopsMoocsCertifications;
        await syncTrainingEntryCoConductors(db, session.collegeId, id, newDisplayName || oldDisplayName, previousEntries, nextEntries);
      } catch (syncErr) {
        console.error("[college/faculty/[id] PATCH] co-conductor sync failed:", syncErr);
      }
    }

    let actorName = "Unknown";
    try {
      const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    } catch { /* best-effort */ }

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "FACULTY_UPDATED",
      performedBy: session.uid,
      performedByName: actorName,
      targetId: id,
      details: { name: newDisplayName || oldDisplayName, fields: Object.keys(updates).filter((k) => k !== "updatedAt") },
      timestamp: new Date(),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const { id } = await params;

    const db = getAdminDb();
    const ref = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("facultyMembers")
      .doc(id);

    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const facultyData = snap.data() as { legalName?: string; userUid?: string; department?: string };

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodManageFacultyDepartment(scope, facultyData.department ?? "")) {
        return NextResponse.json({ error: "That faculty member is outside your department scope" }, { status: 403 });
      }
    }

    // Refuse to hard-delete a faculty member who still has live teaching
    // assignments/timetable slots - deleting the doc out from under them would
    // orphan those references (facultyId pointing at nothing). Use the
    // RESIGNED/RETIRED status instead, which keeps the record (and every
    // assignment that names it) intact.
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const [assignmentSnap, slotSnap] = await Promise.all([
      collegeRef.collection("teachingAssignments").where("facultyId", "==", id).limit(1).get(),
      collegeRef.collection("timetableSlots").where("facultyId", "==", id).limit(1).get(),
    ]);
    if (!assignmentSnap.empty || !slotSnap.empty) {
      return NextResponse.json(
        {
          error:
            "This faculty member still has active teaching assignments or timetable slots. Remove/reassign those first, or set their status to Resigned/Retired instead of deleting the record.",
        },
        { status: 409 }
      );
    }

    await ref.delete();

    // Also remove the linked login account - otherwise it lingers in
    // colleges/{id}/users forever and keeps showing up in panel-member
    // pickers, staff lists, etc. even though the faculty record is gone.
    const linkedUid = facultyData.userUid;
    if (linkedUid) {
      await db.collection("colleges").doc(session.collegeId).collection("users").doc(linkedUid).delete();
      await db.collection("systemUsers").doc(linkedUid).delete();

      // Best-effort: remove the Firebase Auth account too. If it fails, the
      // Firestore records are still gone, which is what the UI reads from.
      try {
        const { getAdminAuth } = await import("@/lib/firebase/admin");
        const auth = await getAdminAuth();
        await auth.deleteUser(linkedUid);
      } catch (authErr) {
        console.warn("[college/faculty/[id] DELETE] Auth deletion failed (non-fatal):", authErr);
      }
    }

    let actorName = "Unknown";
    try {
      const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    } catch { /* best-effort */ }

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "FACULTY_DELETED",
      performedBy: session.uid,
      performedByName: actorName,
      targetId: id,
      details: { name: facultyDisplayName(facultyData) },
      timestamp: new Date(),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
