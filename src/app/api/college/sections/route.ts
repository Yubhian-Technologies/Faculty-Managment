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
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER");
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
    } else if (session.role === "PANEL_MEMBER") {
      query = query.where("facultyInchargeUid", "==", session.uid);
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
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
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

    // Reject years the college hasn't opened via Academic Years. Colleges that have
    // never configured any academic years yet are left unrestricted (no doc to check
    // against), so this only enforces once someone has actually set the list up.
    const academicYearsSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("academicYears")
      .get();
    if (!academicYearsSnap.empty) {
      const activeYears = new Set(
        academicYearsSnap.docs
          .map((d) => d.data() as { yearNumber: number; isActive: boolean })
          .filter((y) => y.isActive)
          .map((y) => y.yearNumber)
      );
      if (!activeYears.has(Number(body.year))) {
        return NextResponse.json({ error: `Year ${body.year} is not open for this college` }, { status: 400 });
      }
    }

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
