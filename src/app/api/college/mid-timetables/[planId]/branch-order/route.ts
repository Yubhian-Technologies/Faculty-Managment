export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { guardError } from "@/lib/midBank/server";
import { loadPlan, MID_TIMETABLE_EDITORS, midTimetableRefs } from "@/lib/midTimetable/server";

// Exam Cell: the order branches are listed in for one Mid timetable - { order: branchKey[] }. Used by the builder's
// sheet, every PDF and the published views. Only the order is saved; nothing else on the plan changes.
type Params = { params: Promise<{ planId: string }> };

export async function PUT(request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...MID_TIMETABLE_EDITORS);
    const { planId } = await params;
    const body = (await readJsonBody(request)) as { order?: unknown };
    if (!Array.isArray(body.order)) return NextResponse.json({ error: "order must be a list of branches" }, { status: 400 });
    const order = [...new Set(body.order.map(String).map((x) => x.trim()).filter(Boolean))].slice(0, 100);
    const db = getAdminDb();
    if (!(await loadPlan(db, session.collegeId, planId))) return NextResponse.json({ error: "Timetable not found. It may have been deleted." }, { status: 404 });
    await midTimetableRefs(db, session.collegeId).plans.doc(planId).update({ branchOrder: order, updatedAt: new Date() });
    return NextResponse.json({ branchOrder: order });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[college/mid-timetables/[planId]/branch-order PUT]");
  }
}
