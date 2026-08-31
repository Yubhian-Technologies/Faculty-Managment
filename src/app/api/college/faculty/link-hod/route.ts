export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import type { Designation, EmploymentType, FacultyStatus } from "@/types";

// An HOD or Sub-HOD login (Department.hodUid/hodName, role "HOD" on their
// `users` doc) is "just a normal HOD account, no separate role" - it never
// gets a `facultyMembers` record of its own (no HOD-creation flow writes
// one - see CreateHodDialog/POST /api/college/users), so a Sub-HOD shows up
// on the Faculty Register only as a bare name, with none of the rich profile
// (Personal Details/Academic Qualification/Research/.../Teaching Load) a
// regular faculty member has. This route completes that gap: it creates a
// facultyMembers doc for an ALREADY-EXISTING login, unlike POST
// /api/college/faculty which always mints a brand new Firebase Auth account
// - reusing that route here would either fail (their email is already
// registered) or, worse, create a second, disconnected login for the same
// person.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");

    const body = (await request.json()) as {
      linkUid: string;
      department: string;
      employeeId: string;
      apaarFacultyId?: string;
      name: string;
      phone?: string;
      designation: Designation;
      qualification: string;
      specialization?: string;
      experienceYears: number;
      joiningDate: string;
      dateOfJoiningDepartment?: string;
      employmentType: EmploymentType;
      aicteEligible?: boolean;
      academicProfile?: Record<string, unknown>;
      technicalProfile?: Record<string, unknown>;
      profilePhotoUrl?: string;
    } & PersonalDetailsInput;

    const {
      linkUid, department, employeeId, name, designation, qualification,
      experienceYears, joiningDate, employmentType, profilePhotoUrl,
    } = body;

    if (!linkUid || !department || !employeeId || !name || !designation || !qualification || !employmentType || !joiningDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (profilePhotoUrl !== undefined && !profilePhotoUrl.startsWith("https://firebasestorage.googleapis.com/")) {
      return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, collegeId, session.uid);
      if (!canHodEditDepartment(scope, department)) {
        return NextResponse.json(
          { error: "That department is not yours or one of your sub-departments" },
          { status: 403 },
        );
      }
    }

    // The target login must actually BE this department's recorded HOD -
    // otherwise any caller could hand-craft a request to attach a faculty
    // profile to an arbitrary login they merely guessed the uid of.
    const targetUserSnap = await db.collection("colleges").doc(collegeId).collection("users").doc(linkUid).get();
    if (!targetUserSnap.exists) {
      return NextResponse.json({ error: "That login no longer exists" }, { status: 404 });
    }
    const targetUser = targetUserSnap.data() as { role?: string; department?: string; departments?: string[]; email?: string; name?: string };
    const targetDepartments = targetUser.departments && targetUser.departments.length > 0 ? targetUser.departments : (targetUser.department ? [targetUser.department] : []);
    if (targetUser.role !== "HOD" || !targetDepartments.includes(department)) {
      return NextResponse.json({ error: "That login is not this department's HOD" }, { status: 400 });
    }

    // Idempotent - a second attempt (e.g. a page double-submit, or someone
    // else completing it moments earlier) returns the existing record instead
    // of creating a duplicate faculty profile for the same login.
    const existingForUid = await db.collection("colleges").doc(collegeId).collection("facultyMembers")
      .where("userUid", "==", linkUid).limit(1).get();
    if (!existingForUid.empty) {
      return NextResponse.json({ id: existingForUid.docs[0].id, alreadyExists: true }, { status: 200 });
    }

    const existingEmployeeId = await db.collection("colleges").doc(collegeId).collection("facultyMembers")
      .where("employeeId", "==", employeeId).limit(1).get();
    if (!existingEmployeeId.empty) {
      return NextResponse.json({ error: "Employee ID already exists" }, { status: 409 });
    }

    const now = new Date();
    const docRef = db.collection("colleges").doc(collegeId).collection("facultyMembers").doc();

    await docRef.set({
      collegeId,
      department,
      employeeId,
      ...(body.apaarFacultyId ? { apaarFacultyId: body.apaarFacultyId } : {}),
      name: name.trim(),
      // The login's own email is the source of truth for collegeEmail - never
      // trust a client-submitted value for it here, since there is no new
      // Auth account being created for it to actually match.
      collegeEmail: targetUser.email ?? "",
      phone: body.phone ?? "",
      designation,
      qualification,
      specialization: body.specialization ?? "",
      experienceYears: Number(experienceYears),
      joiningDate: new Date(joiningDate),
      ...(body.dateOfJoiningDepartment ? { dateOfJoiningDepartment: new Date(body.dateOfJoiningDepartment) } : {}),
      employmentType,
      ...(body.aicteEligible !== undefined ? { aicteEligible: body.aicteEligible } : {}),
      status: "ACTIVE" as FacultyStatus,
      userUid: linkUid,
      ...(body.academicProfile ? { academicProfile: body.academicProfile } : {}),
      ...(body.technicalProfile ? { technicalProfile: body.technicalProfile } : {}),
      ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
      ...buildPersonalDetailsUpdate(body),
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/link-hod POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
