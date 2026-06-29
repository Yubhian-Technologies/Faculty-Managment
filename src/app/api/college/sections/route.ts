export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";

async function getHodDept(db: FirebaseFirestore.Firestore, collegeId: string, uid: string): Promise<string> {
  const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
  return (snap.data() as { department?: string } | undefined)?.department ?? "";
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const yearFilter = searchParams.get("year");

    const db = getAdminDb();
    let query = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("sections") as FirebaseFirestore.Query;

    if (session.role === "HOD") {
      const dept = await getHodDept(db, session.collegeId, session.uid);
      if (dept) query = query.where("department", "==", dept);
    }

    if (yearFilter) query = query.where("year", "==", Number(yearFilter));

    const snap = await query.get();
    const sections = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ya = (a as { year?: number }).year ?? 0;
        const yb = (b as { year?: number }).year ?? 0;
        if (ya !== yb) return ya - yb;
        return ((a as { name?: string }).name ?? "").localeCompare((b as { name?: string }).name ?? "");
      });

    return NextResponse.json({ sections });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[sections GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL");
    const body = (await request.json()) as {
      name: string;
      year: number;
      batch: string;
      studentCount?: number;
      facultyInchargeUid?: string;
      facultyInchargeName?: string;
    };

    if (!body.name?.trim() || !body.year || !body.batch?.trim()) {
      return NextResponse.json({ error: "name, year, batch are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const dept = session.role === "HOD"
      ? await getHodDept(db, session.collegeId, session.uid)
      : "";

    const now = new Date();
    const ref = db.collection("colleges").doc(session.collegeId).collection("sections").doc();

    await ref.set({
      collegeId: session.collegeId,
      department: dept,
      name: body.name.trim().toUpperCase(),
      year: Number(body.year),
      batch: body.batch.trim(),
      facultyInchargeUid: body.facultyInchargeUid ?? null,
      facultyInchargeName: body.facultyInchargeName ?? "",
      studentCount: body.studentCount != null ? Math.max(0, Number(body.studentCount)) : 0,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[sections POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
