export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { SUPPORTING_STAFF_ROLE_CATEGORY } from "@/lib/supportingStaff/roleCategory";
import type { SupportingStaffCategory, SupportingStaffDesignation, EmploymentType, FacultyStatus } from "@/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("supportingStaff").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const requiredCategory = SUPPORTING_STAFF_ROLE_CATEGORY[session.role];
    if (requiredCategory && (snap.data() as { staffCategory?: SupportingStaffCategory }).staffCategory !== requiredCategory) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ staff: { id: snap.id, ...snap.data() } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/supporting-staff/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "COLLEGE_OFFICE");
    const { id } = await params;

    const body = (await request.json()) as Partial<{
      name: string;
      employeeId: string;
      email: string;
      phone: string;
      collegeEmail: string;
      staffCategory: SupportingStaffCategory;
      designation: SupportingStaffDesignation;
      otherDesignationTitle: string;
      department: string;
      experienceYears: number;
      joiningDate: string;
      dateOfBirth: string;
      employmentType: EmploymentType;
      status: FacultyStatus;
      gender: string;
      legalName: string;
      fatherName: string;
      motherName: string;
      religion: string;
      caste: string;
      aadharNo: string;
      panNo: string;
      passportNumber: string;
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
      userUid: string;
      supportingStaffProfile: Record<string, unknown>;
      profilePhotoUrl: string;
      joiningLetterUrl: string;
      appointmentLetterUrl: string;
    }>;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("supportingStaff").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const requiredCategory = SUPPORTING_STAFF_ROLE_CATEGORY[session.role];
    if (requiredCategory) {
      if ((snap.data() as { staffCategory?: SupportingStaffCategory }).staffCategory !== requiredCategory) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      // Category is locked to the caller's role - HOD/College Office can't
      // reassign a record into the other role's territory via edit.
      if (body.staffCategory !== undefined && body.staffCategory !== requiredCategory) {
        return NextResponse.json({ error: "Cannot change staff category" }, { status: 403 });
      }
    }

    if (
      body.profilePhotoUrl !== undefined &&
      body.profilePhotoUrl !== "" &&
      (!body.profilePhotoUrl.startsWith("https://firebasestorage.googleapis.com/") ||
        !body.profilePhotoUrl.includes(encodeURIComponent(`profile-photos/${id}_`)))
    ) {
      return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.employeeId !== undefined && body.employeeId.trim()) {
      const newEmployeeId = body.employeeId.trim();
      const currentEmployeeId = (snap.data() as { employeeId?: string }).employeeId;
      if (newEmployeeId !== currentEmployeeId) {
        const dupSnap = await db
          .collection("colleges")
          .doc(session.collegeId)
          .collection("supportingStaff")
          .where("employeeId", "==", newEmployeeId)
          .limit(1)
          .get();
        if (!dupSnap.empty) {
          return NextResponse.json({ error: "Employee ID already exists" }, { status: 409 });
        }
      }
      updates.employeeId = newEmployeeId;
    }

    const stringFields = [
      "name", "email", "phone", "collegeEmail", "staffCategory", "designation", "otherDesignationTitle",
      "department", "employmentType", "status", "gender", "legalName",
      "fatherName", "motherName", "religion", "caste", "aadharNo", "passportNumber",
      "emergencyContactName", "emergencyContactPhone", "ratificationStatus", "userUid",
      "maritalStatus", "spouseName", "referral", "nativePlace", "temporaryAddress", "permanentAddress", "bloodGroup",
    ] as const;
    for (const key of stringFields) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    if (body.panNo !== undefined) updates.panNo = body.panNo.toUpperCase();

    if (body.experienceYears !== undefined) updates.experienceYears = Number(body.experienceYears);
    if (body.numberOfChildren !== undefined) updates.numberOfChildren = Number(body.numberOfChildren);
    if (body.permanentSameAsTemporary !== undefined) updates.permanentSameAsTemporary = body.permanentSameAsTemporary;

    if (body.supportingStaffProfile !== undefined) updates.supportingStaffProfile = body.supportingStaffProfile;

    if (body.joiningDate) updates.joiningDate = new Date(body.joiningDate);
    if (body.dateOfBirth) updates.dateOfBirth = new Date(body.dateOfBirth);
    if (body.ratificationDate) updates.ratificationDate = new Date(body.ratificationDate);

    if (body.profilePhotoUrl !== undefined) updates.profilePhotoUrl = body.profilePhotoUrl;

    for (const field of ["joiningLetterUrl", "appointmentLetterUrl"] as const) {
      if (body[field] !== undefined) {
        if (body[field] !== "" && !body[field].startsWith("https://firebasestorage.googleapis.com/")) {
          return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });
        }
        updates[field] = body[field];
      }
    }

    await ref.update(updates);

    if (body.profilePhotoUrl !== undefined || body.name !== undefined) {
      const linkedUid = (snap.data() as { userUid?: string }).userUid;
      if (linkedUid) {
        const loginSync: Record<string, string> = {};
        if (body.profilePhotoUrl !== undefined) loginSync.profilePhotoUrl = body.profilePhotoUrl;
        if (body.name !== undefined) loginSync.name = body.name;
        try {
          await db.collection("colleges").doc(session.collegeId).collection("users").doc(linkedUid)
            .set(loginSync, { merge: true });
          await db.collection("systemUsers").doc(linkedUid).set(loginSync, { merge: true });
        } catch { /* non-fatal */ }
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/supporting-staff/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("HOD", "COLLEGE_OFFICE");
    const { id } = await params;

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("supportingStaff").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const staffData = snap.data() as { name?: string; userUid?: string; staffCategory?: SupportingStaffCategory };

    const requiredCategory = SUPPORTING_STAFF_ROLE_CATEGORY[session.role];
    if (requiredCategory && staffData.staffCategory !== requiredCategory) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await ref.delete();

    const linkedUid = staffData.userUid;
    if (linkedUid) {
      await db.collection("colleges").doc(session.collegeId).collection("users").doc(linkedUid).delete();
      await db.collection("systemUsers").doc(linkedUid).delete();

      try {
        const { getAdminAuth } = await import("@/lib/firebase/admin");
        const auth = await getAdminAuth();
        await auth.deleteUser(linkedUid);
      } catch (authErr) {
        console.warn("[college/supporting-staff/[id] DELETE] Auth deletion failed (non-fatal):", authErr);
      }
    }

    let actorName = "Unknown";
    try {
      const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Unknown";
    } catch { /* best-effort */ }

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "SUPPORTING_STAFF_DELETED",
      performedBy: session.uid,
      performedByName: actorName,
      targetId: id,
      details: { name: staffData.name ?? "" },
      timestamp: new Date(),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/supporting-staff/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
