export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import { getHodDepartmentScope, getRelatedDepartmentNames, canHodEditDepartment } from "@/lib/departments/scope";
import { LEGACY_TECHNICAL_DESIGNATIONS } from "@/lib/designations/config";
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
    // A parent department's HOD manages its sub-departments' faculty too, so
    // they are listed alongside their own - needed both to pick a sub-department
    // specialist when assigning a shared/parent-owned subject, and to administer
    // those faculty directly (see canHodEditDepartment in lib/departments/scope).
    let childDeptQuery: FirebaseFirestore.Query | null = null;
    // A feeder's faculty pool (e.g. Basic Science, for any department it
    // feeds via secondaryDepartments - see resolveSubjectDepartment) is
    // staffable for that department's shared 1st-year subjects - a fed
    // department's own faculty roster is often empty since the feeder's
    // faculty already cover it - but stays view-only below: this HOD doesn't
    // manage the feeder's own faculty records.
    let feederDeptQuery: FirebaseFirestore.Query | null = null;

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (scope.departmentName) primaryQuery = primaryQuery.where("department", "==", scope.departmentName);

      // Sub-departments (parent HOD) and grouped/managed branches (sub-HOD)
      // are both fully-owned, so one query covers both, tagged "primary" below.
      const ownedNames = [...scope.childDepartmentNames, ...scope.managedDepartmentNames];
      if (ownedNames.length > 0) {
        childDeptQuery = withStatus(facultyColl.where("department", "in", ownedNames.slice(0, 30)));
      }

      if (scope.departmentName) {
        const relatedNames = await getRelatedDepartmentNames(db, session.collegeId, scope.departmentName);
        const feederNames = relatedNames.filter((n) => n !== scope.departmentName && !ownedNames.includes(n));
        if (feederNames.length > 0) {
          feederDeptQuery = withStatus(facultyColl.where("department", "in", feederNames.slice(0, 30)));
        }
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

    const [primarySnap, childDeptSnap, feederDeptSnap] = await Promise.all([
      primaryQuery.get(),
      childDeptQuery ? childDeptQuery.get() : Promise.resolve(null),
      feederDeptQuery ? feederDeptQuery.get() : Promise.resolve(null),
    ]);

    const faculty: { id: string; accessLevel: "primary" | "secondary"; [key: string]: unknown }[] =
      primarySnap.docs.map((d) => ({ id: d.id, ...d.data(), accessLevel: "primary" }));
    if (childDeptSnap) {
      // "primary", not "secondary": for an HOD this query holds their own
      // sub-departments' faculty, which they fully manage (canHodEditDepartment),
      // so the UI must not mark them view-only.
      for (const d of childDeptSnap.docs) {
        faculty.push({ id: d.id, ...d.data(), accessLevel: "primary" });
      }
    }
    if (feederDeptSnap) {
      // "secondary": staffable for a shared subject, but this HOD doesn't
      // manage the feeder's own faculty records.
      for (const d of feederDeptSnap.docs) {
        faculty.push({ id: d.id, ...d.data(), accessLevel: "secondary" });
      }
    }
    // Technical designations belong to Supporting Staff now (see
    // LEGACY_TECHNICAL_DESIGNATIONS) - excluded here rather than at query time
    // (Firestore only allows one inequality filter per query, already spent on
    // department/status) so the Faculty Register stays teaching-only even for
    // any pre-migration record still sitting in facultyMembers.
    const teachingOnly = faculty.filter((f) => !LEGACY_TECHNICAL_DESIGNATIONS.includes(f.designation as string));

    teachingOnly.sort((a, b) => {
      const an = (a.name as string | undefined) ?? "";
      const bn = (b.name as string | undefined) ?? "";
      return an.localeCompare(bn);
    });
    return NextResponse.json({ faculty: teachingOnly });
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
      technicalProfile?: Record<string, unknown>;
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

    // Resolve the owning department. A parent HOD may add faculty straight into
    // one of their sub-departments by naming it; anything else falls back to
    // their own department. A sub-HOD has no children, so they always land on
    // their own either way.
    let department = body.department ?? "";
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, collegeId, session.uid);
      const requested = body.department?.trim();
      if (requested && !canHodEditDepartment(scope, requested)) {
        return NextResponse.json(
          { error: "That department is not yours or one of your sub-departments" },
          { status: 403 },
        );
      }
      department = requested || scope.departmentName;
    } else if (!department) {
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
      ...(body.technicalProfile ? { technicalProfile: body.technicalProfile } : {}),
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
