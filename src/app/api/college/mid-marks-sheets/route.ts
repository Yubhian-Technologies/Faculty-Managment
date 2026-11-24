export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { myMidClasses, openSheet } from "@/lib/midMarks/server";
import { MidMarksError } from "@/lib/midMarks/sheet";
import { midMarksErrorResponse } from "@/lib/midMarks/http";

// Faculty > Mid Marks (colleges with examSettings/mid.midMarksPage on).
// GET: the login's sections x Mids with a printed paper, each with its sheet status and whether entry is open.
// POST { assignmentId, midNumber }: open that section's sheet (created from the printed paper / re-listed from the
// roster while a draft and entry is open; never written while entry is closed).

export async function GET() {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    return NextResponse.json({ classes: await myMidClasses(getAdminDb(), session.collegeId, session.uid) });
  } catch (err) {
    return midMarksErrorResponse(err, "[college/mid-marks-sheets GET]");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const body = (await readJsonBody(request)) as { assignmentId?: unknown; midNumber?: unknown };
    if (typeof body.assignmentId !== "string" || !body.assignmentId) throw new MidMarksError("Select a section.");
    const db = getAdminDb();
    const me = (await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get()).data() as { name?: string } | undefined;
    return NextResponse.json(await openSheet(db, session.collegeId, session.uid, me?.name ?? session.email, body.assignmentId, Number(body.midNumber)));
  } catch (err) {
    return midMarksErrorResponse(err, "[college/mid-marks-sheets POST]");
  }
}
