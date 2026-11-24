export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { notify } from "@/lib/notify";
import { midMarksSheetsCol, SHEET_ID_RE } from "@/lib/midMarks/server";
import { MidMarksError } from "@/lib/midMarks/sheet";
import { midMarksErrorResponse } from "@/lib/midMarks/http";
import type { MidMarksSheet } from "@/types/midMarks";

// Exam Cell > Mid Marks > "Freeze All Submitted": POST { sheetIds } (<= 300) freezes every one that is SUBMITTED
// (others are skipped and counted). Each in its own transaction; each faculty member told once.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const body = (await readJsonBody(request)) as { sheetIds?: unknown };
    const ids = [...new Set((Array.isArray(body.sheetIds) ? body.sheetIds : []).filter((x): x is string => typeof x === "string" && SHEET_ID_RE.test(x)))].slice(0, 300);
    if (!ids.length) throw new MidMarksError("Select the sheets to freeze.");
    const db = getAdminDb();
    const c = session.collegeId;
    const byName = ((await db.collection("colleges").doc(c).collection("users").doc(session.uid).get()).data() as { name?: string } | undefined)?.name ?? session.email;
    const at = new Date().toISOString();
    const frozen: MidMarksSheet[] = [];
    let skipped = 0;
    for (const id of ids) {
      const ref = midMarksSheetsCol(db, c).doc(id);
      const done = await db.runTransaction(async (tx) => {
        const cur = (await tx.get(ref)).data() as MidMarksSheet | undefined;
        if (!cur || cur.status !== "SUBMITTED") return null;
        const next: MidMarksSheet = { ...cur, status: "FROZEN", frozenAt: at, frozenByName: byName, rev: cur.rev + 1, updatedAt: at, updatedByName: byName,
          history: [...(cur.history ?? []), { at, byName, action: "FROZEN" as const }].slice(-30) };
        tx.set(ref, next);
        return next;
      });
      if (done) frozen.push(done); else skipped += 1;
    }
    const byFaculty = new Map<string, MidMarksSheet[]>();
    for (const s of frozen) byFaculty.set(s.facultyId, [...(byFaculty.get(s.facultyId) ?? []), s]);
    for (const [facultyId, list] of byFaculty) {
      const uid = (await db.collection("colleges").doc(c).collection("facultyMembers").doc(facultyId).get()).get("userUid") as string | undefined;
      if (!uid) continue;
      await notify(db, c, uid, "GENERAL", "Mid Marks Frozen",
        `The Exam Cell froze your Mid marks: ${list.map((s) => `Mid-${s.midNumber} ${s.subjectName} ${s.sectionName}`).join("; ")}. To change them, send a change request.`, "/panel/mid-marks").catch(() => undefined);
    }
    await writeAuditLogSafe(db, c, { action: "MID_MARKS_SHEETS_FROZEN", performedBy: session.uid, performedByName: byName, targetId: "bulk", details: { frozen: frozen.length, skipped } });
    return NextResponse.json({ frozen: frozen.length, skipped });
  } catch (err) {
    return midMarksErrorResponse(err, "[college/mid-marks-sheets/freeze POST]");
  }
}
