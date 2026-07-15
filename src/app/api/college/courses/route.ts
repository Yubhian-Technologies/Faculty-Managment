export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "SUPER_ADMIN", "HOD", "COLLEGE_OFFICE", "ACCOUNTS", "PANEL_MEMBER");
    const { searchParams } = new URL(request.url);
    let departmentId = searchParams.get("departmentId");

    const db = getAdminDb();

    if (!departmentId && session.role === "HOD") {
      const userSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
      const deptName = (userSnap.data() as { department?: string } | undefined)?.department;
      if (deptName) {
        const deptSnap = await db.collection("colleges").doc(session.collegeId).collection("departments")
          .where("name", "==", deptName).limit(1).get();
        departmentId = deptSnap.empty ? "__none__" : deptSnap.docs[0].id;
      }
    }

    let query = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("courses") as FirebaseFirestore.Query;

    if (departmentId) query = query.where("departmentId", "==", departmentId);

    const snap = await query.get();
    const courses = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => ((a as { name?: string }).name ?? "").localeCompare((b as { name?: string }).name ?? ""));

    return NextResponse.json({ courses });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/courses GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      departmentId: string;
      name: string;
      code: string;
      durationYears: number;
    };

    const { departmentId, name, code, durationYears } = body;
    if (!departmentId || !name?.trim() || !code?.trim() || !durationYears) {
      return NextResponse.json({ error: "departmentId, name, code and durationYears are required" }, { status: 400 });
    }
    if (durationYears < 1 || durationYears > 10) {
      return NextResponse.json({ error: "durationYears must be between 1 and 10" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();

    const ref = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("courses")
      .add({
        collegeId: session.collegeId,
        departmentId,
        name: name.trim(),
        code: code.toUpperCase().trim(),
        durationYears: Number(durationYears),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/courses POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
