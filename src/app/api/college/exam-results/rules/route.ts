export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { normalizeResultRules } from "@/lib/examResults/rules";
import { actorName, loadResultRules, rulesRef } from "@/lib/examResults/store";

// The Exam Cell's Result Rules: grade tables and when SGPA / CGPA are shown.
// A college that has saved none gets the starter rules back, with saved: false.

function guardError(err: unknown, tag: string) {
  const badBody = badBodyResponse(err);
  if (badBody) return badBody;
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.error(tag, err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

export async function GET() {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL");
    const { rules, saved } = await loadResultRules(getAdminDb(), session.collegeId);
    return NextResponse.json({ rules, saved });
  } catch (err) {
    return guardError(err, "[exam-results/rules GET]");
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const cleaned = normalizeResultRules(await readJsonBody(request));
    if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });

    const db = getAdminDb();
    const name = await actorName(db, session.collegeId, session.uid);
    const before = (await rulesRef(db, session.collegeId).get()).data() ?? null;
    // Replaced whole (not merged) so a grade table removed on the page is removed here.
    await rulesRef(db, session.collegeId).set({ ...cleaned.rules, updatedBy: session.uid, updatedByName: name, updatedAt: new Date() });
    await writeAuditLogSafe(db, session.collegeId, {
      action: "EXAM_RESULT_RULES_UPDATED",
      performedBy: session.uid,
      performedByName: name,
      details: {
        before: before ? { gradeTables: before.gradeTables, showSgpa: before.showSgpa, showCgpa: before.showCgpa, decimals: before.decimals } : null,
        after: cleaned.rules,
      },
    });
    return NextResponse.json({ rules: cleaned.rules, saved: true });
  } catch (err) {
    return guardError(err, "[exam-results/rules PUT]");
  }
}
