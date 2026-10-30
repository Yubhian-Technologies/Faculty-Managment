export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { guardError } from "@/lib/midBank/server";
import { seatingTimingCheck } from "@/lib/exams/seatingPairedServer";

// A paired seating plan against the Mid timetable's exam timings: room clashes
// with other plans, exams of its branches outside its session, branches whose
// session changed since it was built. Read-only.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL");
    const { id } = await params;
    const check = await seatingTimingCheck(getAdminDb(), session.collegeId, id);
    if (!check) return NextResponse.json({ error: "Not a seating plan built from the Mid timetable" }, { status: 404 });
    return NextResponse.json(check);
  } catch (err) {
    return guardError(err, "[college/exam-seating/[id]/check GET]");
  }
}
