export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodManageFacultyDepartment } from "@/lib/departments/scope";
import type { Designation, EmploymentType, FacultyStatus } from "@/types";

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

    return NextResponse.json({ faculty: { id: snap.id, ...snap.data() } });
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
      name: string;
      employeeId: string;
      apaarFacultyId: string;
      email: string;
      phone: string;
      collegeEmail: string;
      designation: Designation;
      qualification: string;
      specialization: string;
      experienceYears: number;
      internalExperience: number;
      externalExperience: number;
      inCampusExperience: number;
      industryExperience: number;
      researchExperience: number;
      joiningDate: string;
      dateOfJoiningDepartment: string;
      dateOfBirth: string;
      employmentType: EmploymentType;
      aicteEligible: boolean;
      status: FacultyStatus;
      gender: string;
      legalName: string;
      nameAsPerAadhar: string;
      fatherName: string;
      motherName: string;
      religion: string;
      caste: string;
      subCaste: string;
      aadharNo: string;
      panNo: string;
      passportNumber: string;
      sscHallTicketNo: string;
      differentlyAbled: boolean;
      differentlyAbledDetails: string;
      bankAccountNo: string;
      ifscCode: string;
      emergencyContactName: string;
      emergencyContactPhone: string;
      ratificationStatus: string;
      ratificationDate: string;
      maritalStatus: string;
      spouseName: string;
      numberOfChildren: number;
      referral: string;
      nativePlace: string;
      temporaryAddress: string;
      permanentSameAsTemporary: boolean;
      permanentAddress: string;
      bloodGroup: string;
      hasPHD: boolean;
      userUid: string;
      academicProfile: Record<string, unknown>;
      technicalProfile: Record<string, unknown>;
      profilePhotoUrl: string;
      joiningLetterUrl: string;
      appointmentLetterUrl: string;
      resumeUrl: string;
    }>;

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

    // permanentAddress is deliberately excluded here - see the dedicated
    // handling below, which overrides it with temporaryAddress whenever
    // permanentSameAsTemporary is true rather than trusting whatever (if
    // anything) the caller sent for it directly.
    const stringFields = [
      "name", "email", "phone", "collegeEmail", "apaarFacultyId", "designation", "qualification",
      "specialization", "employmentType", "status", "gender", "legalName", "nameAsPerAadhar",
      "fatherName", "motherName", "religion", "caste", "subCaste", "aadharNo", "passportNumber",
      "sscHallTicketNo", "differentlyAbledDetails", "bankAccountNo",
      "emergencyContactName", "emergencyContactPhone", "ratificationStatus", "userUid",
      "maritalStatus", "spouseName", "referral", "nativePlace", "temporaryAddress", "bloodGroup",
    ] as const;

    for (const key of stringFields) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    // PAN / IFSC always uppercase
    if (body.panNo !== undefined) updates.panNo = body.panNo.toUpperCase();
    if (body.ifscCode !== undefined) updates.ifscCode = body.ifscCode.toUpperCase();

    // Numeric fields
    const numFields = [
      "experienceYears", "internalExperience", "externalExperience",
      "inCampusExperience", "industryExperience", "researchExperience", "numberOfChildren",
    ] as const;
    for (const key of numFields) {
      if (body[key] !== undefined) updates[key] = Number(body[key]);
    }

    // Boolean
    if (body.hasPHD !== undefined) updates.hasPHD = body.hasPHD;
    if (body.aicteEligible !== undefined) updates.aicteEligible = body.aicteEligible;
    if (body.permanentSameAsTemporary !== undefined) updates.permanentSameAsTemporary = body.permanentSameAsTemporary;
    if (body.differentlyAbled !== undefined) updates.differentlyAbled = body.differentlyAbled;

    // "Same as temporary" means the permanent address IS the temporary
    // address - copied automatically rather than left blank or trusting a
    // stray permanentAddress value sent alongside. Only applies when
    // temporaryAddress is part of this same call (the personal-module editor
    // always sends the whole section together); otherwise a direct
    // permanentAddress update still goes through untouched.
    if (body.permanentSameAsTemporary === true && body.temporaryAddress !== undefined) {
      updates.permanentAddress = body.temporaryAddress;
    } else if (body.permanentAddress !== undefined) {
      updates.permanentAddress = body.permanentAddress;
    }

    // Academic profile (Modules 1-5) / Technical profile - mutually exclusive by designation
    if (body.academicProfile !== undefined) updates.academicProfile = body.academicProfile;
    if (body.technicalProfile !== undefined) updates.technicalProfile = body.technicalProfile;

    // Date fields
    if (body.joiningDate) updates.joiningDate = new Date(body.joiningDate);
    if (body.dateOfJoiningDepartment) updates.dateOfJoiningDepartment = new Date(body.dateOfJoiningDepartment);
    if (body.dateOfBirth) updates.dateOfBirth = new Date(body.dateOfBirth);
    if (body.ratificationDate) updates.ratificationDate = new Date(body.ratificationDate);

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

    await ref.update(updates);

    // Best-effort: if this faculty record has a linked system login, keep their
    // name/photo in sync there too - the login doc (colleges/{id}/users) is what
    // panel-member pickers, notifications, and the nav/avatar read from, so edits
    // made here on the faculty details page must propagate or those surfaces show
    // stale data from account creation time.
    if (body.profilePhotoUrl !== undefined || body.name !== undefined) {
      const linkedUid = (snap.data() as { userUid?: string }).userUid;
      if (linkedUid) {
        const loginSync: Record<string, string> = {};
        if (body.profilePhotoUrl !== undefined) loginSync.profilePhotoUrl = body.profilePhotoUrl;
        if (body.name !== undefined) loginSync.name = body.name;
        try {
          await db.collection("colleges").doc(session.collegeId).collection("users").doc(linkedUid)
            .set(loginSync, { merge: true });
          await db.collection("systemUsers").doc(linkedUid)
            .set(loginSync, { merge: true });
        } catch { /* non-fatal */ }
      }
    }

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
    const facultyData = snap.data() as { name?: string; userUid?: string; department?: string };

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodManageFacultyDepartment(scope, facultyData.department ?? "")) {
        return NextResponse.json({ error: "That faculty member is outside your department scope" }, { status: 403 });
      }
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
      details: { name: facultyData.name ?? "" },
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
