export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { recentAcademicSessions } from "@/lib/college/academicSession";
import type { SummerHoliday } from "@/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// One continuous break period per academic year (doc id = academicYear, so
// setting it again for the same year overwrites rather than duplicates) -
// see SummerHoliday's own doc-comment. Read is open to every role that can
// apply for leave (SummerHolidayBanner.tsx fetches this once for the whole
// dashboard shell), same role list as holidays/route.ts GET.
export async function GET() {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
    );
    const db = getAdminDb();
    const snap = await db
      .collection("colleges").doc(session.collegeId).collection("summerHolidays")
      .orderBy("fromDate", "desc")
      .get();
    const summerHolidays = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SummerHoliday);
    return NextResponse.json({ summerHolidays });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/summer-holidays GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// College Office only (not Principal/VP, unlike the single-date Holidays
// list) - sets/updates the one range for a given academic year.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");
    const body = (await request.json()) as { academicYear?: string; fromDate?: string; toDate?: string };

    const academicYear = body.academicYear?.trim();
    const fromDateStr = body.fromDate?.trim();
    const toDateStr = body.toDate?.trim();

    if (!academicYear || !fromDateStr || !toDateStr || !DATE_RE.test(fromDateStr) || !DATE_RE.test(toDateStr)) {
      return NextResponse.json({ error: "academicYear, fromDate and toDate (YYYY-MM-DD) are required" }, { status: 400 });
    }
    if (!recentAcademicSessions().includes(academicYear)) {
      return NextResponse.json({ error: "Invalid academic year" }, { status: 400 });
    }
    if (toDateStr < fromDateStr) {
      return NextResponse.json({ error: "To date cannot be before From date" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const userSnap = await collegeRef.collection("users").doc(session.uid).get();
    const userName = (userSnap.data() as { name?: string } | undefined)?.name ?? "";

    const now = new Date();
    const docRef = collegeRef.collection("summerHolidays").doc(academicYear);
    const existing = await docRef.get();
    await docRef.set({
      collegeId: session.collegeId,
      academicYear,
      fromDate: parseDate(fromDateStr),
      toDate: parseDate(toDateStr),
      createdBy: session.uid,
      createdByName: userName,
      updatedAt: now,
      ...(existing.exists ? {} : { createdAt: now }),
    }, { merge: true });

    return NextResponse.json({ id: academicYear });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/summer-holidays POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
