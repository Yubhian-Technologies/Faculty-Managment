export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { recentAcademicSessions } from "@/lib/college/academicSession";
import { isDateKey } from "@/lib/college/holidayCalendar";
import type { SemBreak, SemBreakKind } from "@/types";

const KINDS: SemBreakKind[] = ["WINTER", "SUMMER"];

function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Students-only winter/summer semester breaks (doc id = `${academicYear}_${kind}`,
// so setting one again overwrites). Faculty keep working - see classDay.ts, the
// only place that reads these to close classes.
export async function GET() {
  try {
    const session = await requireCollegeMember(
      "STUDENT", "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "ACADEMICS", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "HOSTEL", "PD", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
    );
    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("semBreaks")
      .orderBy("fromDate", "desc").get();
    return NextResponse.json({ semBreaks: snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SemBreak) });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/sem-breaks GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "ACADEMICS");
    const body = (await readJsonBody(request)) as {
      academicYear?: string; kind?: SemBreakKind; fromDate?: string; toDate?: string; hostelersOutingAllowed?: boolean;
    };

    const academicYear = body.academicYear?.trim();
    if (!academicYear || !recentAcademicSessions().includes(academicYear)) {
      return NextResponse.json({ error: "Invalid academic year" }, { status: 400 });
    }
    if (!body.kind || !KINDS.includes(body.kind)) {
      return NextResponse.json({ error: "Choose winter or summer sem break" }, { status: 400 });
    }
    if (!isDateKey(body.fromDate) || !isDateKey(body.toDate)) {
      return NextResponse.json({ error: "fromDate and toDate (YYYY-MM-DD) are required" }, { status: 400 });
    }
    if (body.toDate < body.fromDate) {
      return NextResponse.json({ error: "To date cannot be before From date" }, { status: 400 });
    }
    if (body.hostelersOutingAllowed != null && typeof body.hostelersOutingAllowed !== "boolean") {
      return NextResponse.json({ error: "Invalid hostellers outing value" }, { status: 400 });
    }

    const db = getAdminDb();
    const docRef = db.collection("colleges").doc(session.collegeId).collection("semBreaks").doc(`${academicYear}_${body.kind}`);
    const existing = await docRef.get();
    const now = new Date();
    await docRef.set({
      collegeId: session.collegeId,
      academicYear,
      kind: body.kind,
      fromDate: parseDate(body.fromDate),
      toDate: parseDate(body.toDate),
      hostelersOutingAllowed: body.hostelersOutingAllowed ?? false,
      createdBy: session.uid,
      updatedAt: now,
      ...(existing.exists ? {} : { createdAt: now }),
    }, { merge: true });

    return NextResponse.json({ id: docRef.id });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/sem-breaks POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
