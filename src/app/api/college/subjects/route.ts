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
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "VICE_PRINCIPAL");
    const { searchParams } = new URL(request.url);
    const deptFilter = searchParams.get("department");

    const db = getAdminDb();
    let query: FirebaseFirestore.Query = db.collection("colleges").doc(session.collegeId).collection("subjects");

    if (session.role === "HOD") {
      const dept = await getHodDept(db, session.collegeId, session.uid);
      if (dept) query = query.where("department", "==", dept);
    } else if (deptFilter) {
      query = query.where("department", "==", deptFilter);
    }

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
      name: string;
      code: string;
      semester: number;
      hoursPerWeek: number;
      credits: number;
      type: SubjectType;
      department?: string;
    };

    if (!body.name?.trim() || !body.code?.trim() || !body.semester) {
      return NextResponse.json({ error: "name, code, semester are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const department = session.role === "HOD"
      ? await getHodDept(db, session.collegeId, session.uid)
      : (body.department ?? "");

    if (!department) {
      return NextResponse.json({ error: "department is required" }, { status: 400 });
    }

    const now = new Date();
    const ref = await db.collection("colleges").doc(session.collegeId).collection("subjects").add({
      collegeId: session.collegeId,
      department,
      name: body.name.trim(),
      code: body.code.trim().toUpperCase(),
      semester: Number(body.semester),
      hoursPerWeek: Number(body.hoursPerWeek) || 0,
      credits: Number(body.credits) || 0,
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
