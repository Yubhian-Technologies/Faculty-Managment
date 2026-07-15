export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { SubjectType } from "@/types";

async function getHodDept(db: FirebaseFirestore.Firestore, collegeId: string, uid: string): Promise<string> {
  const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
  return (snap.data() as { department?: string } | undefined)?.department ?? "";
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN", "COLLEGE_OFFICE", "PANEL_MEMBER");
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId");
    const year = searchParams.get("year");

    const db = getAdminDb();
    let query = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("subjects") as FirebaseFirestore.Query;

    if (session.role === "HOD") {
      const dept = await getHodDept(db, session.collegeId, session.uid);
      if (dept) query = query.where("department", "==", dept);
    }

    if (courseId) query = query.where("courseId", "==", courseId);
    if (year) query = query.where("year", "==", Number(year));

    const snap = await query.get();
    const subjects = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((a as { name?: string }).name ?? "").localeCompare((b as { name?: string }).name ?? ""));

    return NextResponse.json({ subjects });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/subjects GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      courseId: string;
      year: number;
      name: string;
      code: string;
      hoursPerWeek?: number;
      totalHoursPerSemester?: number;
      credits?: number;
      type?: SubjectType;
    };

    const { courseId, year, name, code } = body;
    if (!courseId || !year || !name?.trim() || !code?.trim()) {
      return NextResponse.json({ error: "courseId, year, name and code are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const courseSnap = await db.collection("colleges").doc(session.collegeId).collection("courses").doc(courseId).get();
    if (!courseSnap.exists) return NextResponse.json({ error: "Course not found" }, { status: 404 });
    const course = courseSnap.data() as { name: string; departmentId: string; durationYears: number };
    if (year < 1 || year > course.durationYears) {
      return NextResponse.json({ error: `Year must be between 1 and ${course.durationYears} for ${course.name}` }, { status: 400 });
    }

    const dept = session.role === "HOD"
      ? await getHodDept(db, session.collegeId, session.uid)
      : "";
    if (session.role === "HOD" && dept) {
      const deptSnap = await db.collection("colleges").doc(session.collegeId).collection("departments")
        .where("name", "==", dept).limit(1).get();
      const deptId = deptSnap.empty ? null : deptSnap.docs[0].id;
      if (deptId !== course.departmentId) {
        return NextResponse.json({ error: "Course does not belong to your department" }, { status: 403 });
      }
    }

    const now = new Date();
    const ref = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("subjects")
      .add({
        collegeId: session.collegeId,
        department: dept,
        departmentId: course.departmentId,
        courseId,
        courseName: course.name,
        year: Number(year),
        name: name.trim(),
        code: code.toUpperCase().trim(),
        hoursPerWeek: body.hoursPerWeek != null ? Number(body.hoursPerWeek) : 0,
        totalHoursPerSemester: body.totalHoursPerSemester != null ? Number(body.totalHoursPerSemester) : null,
        credits: body.credits != null ? Number(body.credits) : 0,
        type: body.type ?? "THEORY",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/subjects POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
