export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { guardError } from "@/lib/midBank/server";
import { sheetMarkColumns } from "@/lib/exams/seatingPairedServer";

// The marks columns of the signature sheets: for each branch + subject of the
// Mid timetables given (?planIds=a,b), the components set in Mid Configuration
// > Marks. Read-only.

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL");
    const planIds = [...new Set((new URL(request.url).searchParams.get("planIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 30);
    if (planIds.length === 0) return NextResponse.json({ columns: {} });
    return NextResponse.json({ columns: await sheetMarkColumns(getAdminDb(), session.collegeId, planIds) });
  } catch (err) {
    return guardError(err, "[college/exam-seating/marks GET]");
  }
}
