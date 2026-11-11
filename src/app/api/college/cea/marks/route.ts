export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { CeaError, ceaErrorResponse } from "@/lib/cea/server";
import { myCeaAssignments, openCeaSheet } from "@/lib/cea/marksServer";

// Faculty > CEA Marks. GET: my sections whose subject has a CEA plan, unit by unit. POST { assignmentId, unit }:
// open that unit's sheet (created / re-listed from the section's roster while a draft).

export async function GET() {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER");
    return NextResponse.json({ assignments: await myCeaAssignments(getAdminDb(), session.collegeId, session.uid) });
  } catch (err) {
    return ceaErrorResponse(err, "[college/cea/marks GET]");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER");
    const body = (await readJsonBody(request)) as { assignmentId?: unknown; unit?: unknown };
    const unit = Number(body.unit);
    if (typeof body.assignmentId !== "string" || !body.assignmentId || !Number.isInteger(unit)) throw new CeaError("Pick a section and unit");
    return NextResponse.json(await openCeaSheet(getAdminDb(), session.collegeId, session.uid, session.email, body.assignmentId, unit));
  } catch (err) {
    return ceaErrorResponse(err, "[college/cea/marks POST]");
  }
}
