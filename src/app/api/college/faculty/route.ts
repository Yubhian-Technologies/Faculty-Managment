export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import { getHodDepartmentScope, getRelatedDepartmentNames } from "@/lib/departments/scope";
import type { Designation, EmploymentType, FacultyStatus } from "@/types";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const { searchParams } = new URL(request.url);
    const deptFilter = searchParams.get("department");
    const statusFilter = searchParams.get("status");

    const db = getAdminDb();
    const facultyColl = db.collection("colleges").doc(session.collegeId).collection("facultyMembers");
    const withStatus = (q: FirebaseFirestore.Query): FirebaseFirestore.Query =>
      statusFilter ? q.where("status", "==", statusFilter) : q;

    let primaryQuery: FirebaseFirestore.Query = facultyColl;
    // A parent department's HOD gets view-only access to its sub-departments'
    // faculty too - needed so they can pick a sub-department specialist when
    // assigning faculty to a shared/parent-owned subject (see teaching-assignments).
    let secondaryQuery: FirebaseFirestore.Query | null = null;

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (scope.departmentName) primaryQuery = primaryQuery.where("department", "==", scope.departmentName);
      if (scope.childDepartmentNames.length > 0) {
        secondaryQuery = withStatus(facultyColl.where("department", "in", scope.childDepartmentNames));
      }
    } else if (deptFilter) {
      // Office/Principal/VP picking faculty for a specific department (e.g.
      // a section's Faculty Incharge) also see faculty registered under that
      // department's parent or sub-departments - a sub-department's own
      // faculty pool is often thin, and the main HOD's faculty may teach
      // there too.
      const relatedNames = await getRelatedDepartmentNames(db, session.collegeId, deptFilter);
      primaryQuery = relatedNames.length > 1
        ? primaryQuery.where("department", "in", relatedNames)
        : primaryQuery.where("department", "==", deptFilter);
    }

    primaryQuery = withStatus(primaryQuery);

    const [primarySnap, secondarySnap] = await Promise.all([
      primaryQuery.get(),
      secondaryQuery ? secondaryQuery.get() : Promise.resolve(null),
    ]);

    const faculty: { id: string; accessLevel: "primary" | "secondary"; [key: string]: unknown }[] =
      primarySnap.docs.map((d) => ({ id: d.id, ...d.data(), accessLevel: "primary" }));
    if (secondarySnap) {
      for (const d of secondarySnap.docs) {
        faculty.push({ id: d.id, ...d.data(), accessLevel: "secondary" });
      }
    }
    faculty.sort((a, b) => {
      const an = (a.name as string | undefined) ?? "";
      const bn = (b.name as string | undefined) ?? "";
      return an.localeCompare(bn);
    });
    return NextResponse.json({ faculty });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");

    const body = (await request.json()) as {
      employeeId: string;
      apaarFacultyId?: string;
      name: string;
      email?: string;
      collegeEmail: string;
      password: string;
      phone?: string;
      designation: Designation;
      qualification: string;
      specialization?: string;
      experienceYears: number;
      joiningDate: string;
      dateOfJoiningDepartment?: string;
      employmentType: EmploymentType;
      aicteEligible?: boolean;
      department?: string;
      academicProfile?: Record<string, unknown>;
      profilePhotoUrl?: string;
    } & PersonalDetailsInput;

    const {
      employeeId,
      name,
      collegeEmail,
      password,
      designation,
      qualification,
      experienceYears,
      joiningDate,
      employmentType,
      profilePhotoUrl,
    } = body;

    if (!employeeId || !name || !collegeEmail || !password || !designation || !qualification || !employmentType || !joiningDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    // Uploaded before the record exists (under a temp id), so we can only check
    // it came from our own upload endpoint, not that it names this specific id.
    if (profilePhotoUrl !== undefined && !profilePhotoUrl.startsWith("https://firebasestorage.googleapis.com/")) {
      return NextResponse.json({ error: "Invalid photo URL" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeId = session.collegeId;

    // Resolve department from HOD's profile if not provided
    let department = body.department ?? "";
    if (session.role === "HOD" || !department) {
      const hodSnap = await db
        .collection("colleges")
        .doc(collegeId)
        .collection("users")
        .doc(session.uid)
        .get();
      department = (hodSnap.data() as { department?: string } | undefined)?.department ?? department;
    }

    // Check employee ID uniqueness within college
    const existing = await db
      .collection("colleges")
      .doc(collegeId)
      .collection("facultyMembers")
      .where("employeeId", "==", employeeId)
      .limit(1)
      .get();

    if (!existing.empty) {
      return NextResponse.json({ error: "Employee ID already exists" }, { status: 409 });
    }

    // College email is the login username - create the Firebase Auth user with it,
    // not the personal email (which is optional, contact-only).
    const uid = await createFirebaseUser(collegeEmail, password, name);

    const now = new Date();

    // Write to users collection (login account)
    await db
      .collection("colleges")
      .doc(collegeId)
      .collection("users")
      .doc(uid)
      .set({
        uid,
        collegeId,
        name,
        email: collegeEmail,
        role: "PANEL_MEMBER",
        department,
        ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

    // Write faculty member record
    const docRef = db
      .collection("colleges")
      .doc(collegeId)
      .collection("facultyMembers")
      .doc();

    await docRef.set({
      collegeId,
      department,
      employeeId,
      ...(body.apaarFacultyId ? { apaarFacultyId: body.apaarFacultyId } : {}),
      name,
      collegeEmail,
      ...(body.email ? { email: body.email } : {}),
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
      userUid: uid,
      ...(body.academicProfile ? { academicProfile: body.academicProfile } : {}),
      ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
      ...buildPersonalDetailsUpdate(body),
      createdAt: now,
      updatedAt: now,
    });

    // Role mapping for Firestore-based session resolution
    await db.collection("systemUsers").doc(uid).set({
      uid, role: "PANEL_MEMBER", collegeId, email: collegeEmail, name,
      ...(profilePhotoUrl ? { profilePhotoUrl } : {}),
    });

    return NextResponse.json({ id: docRef.id, uid }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "auth/email-already-exists"
    ) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    console.error("[college/faculty POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
