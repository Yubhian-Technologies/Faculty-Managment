export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { academicSessionLabel } from "@/lib/college/academicSession";
import type { Holiday, HolidayType } from "@/types";

const HOLIDAY_TYPES: HolidayType[] = ["NATIONAL", "REGIONAL", "COLLEGE", "RESTRICTED"];

// April cutoff, same convention as academicSession.ts's currentAcademicStartYear -
// a Jan/Feb/Mar holiday belongs to the session that started the previous April.
function academicYearForDate(date: Date): string {
  const startYear = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return academicSessionLabel(startYear);
}

// Academic Calendar Holidays - maintained by Office (Principal/VP too, same as
// firestore.rules' isPrincipalOrOffice) so the Leave History Report's
// "Holidays" column (see leave-history-report/route.ts) has something real to
// count instead of a bare "-", and so LeaveApplyForm's live day-count preview
// can exclude them client-side same as the server does (applications/route.ts
// POST queries Firestore directly, so it isn't gated by this role list - this
// is just for the preview to agree with it). Read is open to every role that
// can apply for leave - see applications/route.ts GET's own role list.
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
      .collection("colleges").doc(session.collegeId).collection("holidays")
      .orderBy("date", "asc")
      .get();
    const holidays = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Holiday);
    return NextResponse.json({ holidays });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/holidays GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE");
    const body = (await request.json()) as { date?: string; name?: string; type?: HolidayType };

    if (!body.date || !body.name?.trim() || !body.type) {
      return NextResponse.json({ error: "date, name and type are required" }, { status: 400 });
    }
    if (!HOLIDAY_TYPES.includes(body.type)) {
      return NextResponse.json({ error: "Invalid holiday type" }, { status: 400 });
    }
    const date = new Date(body.date);
    if (Number.isNaN(date.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();
    const docRef = db.collection("colleges").doc(session.collegeId).collection("holidays").doc();
    await docRef.set({
      collegeId: session.collegeId,
      date,
      name: body.name.trim(),
      type: body.type,
      academicYear: academicYearForDate(date),
      createdAt: now,
    });

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/holidays POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
