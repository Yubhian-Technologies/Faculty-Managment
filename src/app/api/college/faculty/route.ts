export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createFirebaseUser } from "@/lib/firebase/authRest";
import { buildPersonalDetailsUpdate, type PersonalDetailsInput } from "@/lib/firestore/personalDetails";
import type { Designation, EmploymentType, FacultyStatus } from "@/types";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE");
    const { searchParams } = new URL(request.url);
    const deptFilter = searchParams.get("department");
    const statusFilter = searchParams.get("status");

    const db = getAdminDb();
    let coll = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("facultyMembers") as FirebaseFirestore.Query;

    // HOD sees only their department's faculty
    if (session.role === "HOD") {
      const hodSnap = await db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("users")
        .doc(session.uid)
        .get();
      const hodDept = (hodSnap.data() as { department?: string } | undefined)?.department ?? "";
      if (hodDept) {
        coll = coll.where("department", "==", hodDept);
      }
    } else if (deptFilter) {
      coll = coll.where("department", "==", deptFilter);
    }

    if (statusFilter) {
      coll = coll.where("status", "==", statusFilter);
    }

    const snap = await coll.get();
    const faculty = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const an = (a as { name?: string }).name ?? "";
        const bn = (b as { name?: string }).name ?? "";
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
    const session = await requireCollegeMember("HOD", "PRINCIPAL");

    const body = (await request.json()) as {
      employeeId: string;
      name: string;
      email: string;
      password: string;
      phone?: string;
      designation: Designation;
      qualification: string;
      specialization?: string;
      experienceYears: number;
      joiningDate: string;
      employmentType: EmploymentType;
      department?: string;
      academicProfile?: Record<string, unknown>;
    } & PersonalDetailsInput;

    const {
      employeeId,
      name,
      email,
      password,
      designation,
      qualification,
      experienceYears,
      joiningDate,
      employmentType,
    } = body;

    if (!employeeId || !name || !email || !password || !designation || !qualification || !employmentType || !joiningDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
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

    // Create Firebase Auth user via REST API (no firebase-admin/auth required)
    const uid = await createFirebaseUser(email, password, name);

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
        email,
        role: "PANEL_MEMBER",
        department,
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
      name,
      email,
      phone: body.phone ?? "",
      designation,
      qualification,
      specialization: body.specialization ?? "",
      experienceYears: Number(experienceYears),
      joiningDate: new Date(joiningDate),
      employmentType,
      status: "ACTIVE" as FacultyStatus,
      userUid: uid,
      ...(body.academicProfile ? { academicProfile: body.academicProfile } : {}),
      ...buildPersonalDetailsUpdate(body),
      createdAt: now,
      updatedAt: now,
    });

    // Role mapping for Firestore-based session resolution
    await db.collection("systemUsers").doc(uid).set({ uid, role: "PANEL_MEMBER", collegeId, email, name });

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
