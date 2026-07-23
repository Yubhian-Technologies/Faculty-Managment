export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { ensureAcademicYear, yearOrdinalLabel } from "@/lib/college/academicYears";

// PRINCIPAL manages this for their own college; SUPER_ADMIN for any college
// (via `?collegeId=`). requireCollegeContext resolves collegeId from the
// session (Principal) or the query param (Super Admin, who carries no collegeId).
export async function GET(request: Request) {
  try {
    const session = await requireCollegeContext(request, "SUPER_ADMIN", "PRINCIPAL", "HOD");
    const db = getAdminDb();

    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("academicYears")
      .orderBy("yearNumber")
      .get();

    const academicYears = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ academicYears });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/academic-years GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Adds the next sequential year (1, 2, 3, …) for the college — the client
// never chooses a yearNumber, it just asks to "add a year" and the server
// appends the next one, keeping the sequence gap-free.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeContext(request, "SUPER_ADMIN", "PRINCIPAL");
    const db = getAdminDb();

    const existingSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("academicYears")
      .get();
    const existingNumbers = existingSnap.docs.map((d) => (d.data() as { yearNumber?: number }).yearNumber ?? 0);
    const nextYearNumber = (existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0) + 1;

    const id = await ensureAcademicYear(db, session.collegeId, nextYearNumber);
    return NextResponse.json({ id, yearNumber: nextYearNumber, label: yearOrdinalLabel(nextYearNumber) }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/academic-years POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Removes only the most-recently-added year (highest yearNumber), keeping the
// sequence gap-free — blocked if any Section already exists for that year.
export async function DELETE(request: Request) {
  try {
    const session = await requireCollegeContext(request, "SUPER_ADMIN", "PRINCIPAL");
    const db = getAdminDb();

    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const existingSnap = await collegeRef.collection("academicYears").get();
    if (existingSnap.empty) {
      return NextResponse.json({ error: "No years to remove" }, { status: 400 });
    }

    const years = existingSnap.docs.map((d) => ({ id: d.id, yearNumber: (d.data() as { yearNumber?: number }).yearNumber ?? 0 }));
    const last = years.reduce((max, y) => (y.yearNumber > max.yearNumber ? y : max), years[0]);

    const sectionsWithYear = await collegeRef
      .collection("sections")
      .where("year", "==", last.yearNumber)
      .limit(1)
      .get();
    if (!sectionsWithYear.empty) {
      return NextResponse.json(
        { error: `Cannot remove Year ${last.yearNumber} — sections already exist for it` },
        { status: 400 }
      );
    }

    await collegeRef.collection("academicYears").doc(last.id).delete();
    return NextResponse.json({ ok: true, removedYearNumber: last.yearNumber });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/academic-years DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
