export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import { syncStudentRollChange, StudentLoginError } from "@/lib/students/provisionLogin";
import { resolveRollMapping } from "@/lib/students/rollMappingResolve";
import { summarizeRollMapping, type RollMapResult } from "@/lib/students/rollMapping";
import { parseRollMapRows } from "@/lib/students/rollMappingRows";
import type { StudentRecord } from "@/types";

/** Written one student at a time, so a failure is one row rather than a batch. */
const CHUNK = 500;

// Sets Roll No on students matched by Student Mobile No.
//
// Writing goes through syncStudentRollChange (lib/students/provisionLogin.ts) -
// the same path the Office's per-student roll edit uses. That claims the roll in
// the global cross-college registry, carries an existing login across to the new
// roll, retires the old roll and writes the student, atomically. Nothing here
// touches rollNumber directly.
//
// The classification is re-run here against freshly-read data rather than
// trusting what the preview returned: a preview is a snapshot, and another
// Office user may have claimed one of these rolls since. A row that has newly
// become a conflict is reported failed, never forced through.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");

    let body: { rows?: unknown; replaceExisting?: unknown };
    try {
      body = (await readJsonBody(request)) as typeof body;
    } catch (err) {
      return badBodyResponse(err) ?? NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const parsed = parseRollMapRows(body.rows);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const replaceExisting = body.replaceExisting === true;
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // Re-classify against current data - see the note above.
    const results = await resolveRollMapping(db, session.collegeId, parsed.rows, replaceExisting);
    const toWrite = results.filter((r) => r.outcome === "WILL_SET" && r.studentId);

    const applied: RollMapResult[] = [];
    const failed: (RollMapResult & { error: string })[] = [];

    for (let i = 0; i < toWrite.length; i += CHUNK) {
      const chunk = toWrite.slice(i, i + CHUNK);
      for (const row of chunk) {
        const studentRef = collegeRef.collection("students").doc(row.studentId!);
        try {
          const snap = await studentRef.get();
          if (!snap.exists) {
            failed.push({ ...row, error: "That student no longer exists" });
            continue;
          }
          const before = snap.data() as Pick<StudentRecord, "rollNumber" | "uid" | "loginEmail" | "name">;

          await syncStudentRollChange(
            db,
            await getAdminAuth(),
            session.collegeId,
            row.studentId!,
            before,
            row.rollTrimmed,
            { updatedAt: new Date() }
          );

          // One entry per changed student, matching the per-student roll edit.
          await collegeRef.collection("auditLogs").add({
            collegeId: session.collegeId,
            action: "STUDENT_ROLL_CHANGED",
            targetId: row.studentId,
            performedBy: session.uid,
            performedByRole: session.role,
            details: {
              name: before.name ?? row.studentName ?? "",
              from: (before.rollNumber ?? "").trim(),
              to: row.rollTrimmed,
              via: "Import Roll Nos",
              matchedOnMobile: row.mobileNormalized,
              fileRow: row.rowNumber,
            },
            timestamp: new Date(),
          });

          applied.push(row);
        } catch (err) {
          // A single student's failure never aborts the run - the Office gets
          // the per-row reason and can re-run just those rows.
          const message = err instanceof StudentLoginError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not set this roll number";
          failed.push({ ...row, error: message });
        }
      }
    }

    // Everything the resolver refused, reported back with its reason so the
    // result file is a complete account of the run.
    const skipped = results.filter((r) => r.outcome !== "WILL_SET");

    return NextResponse.json({
      appliedCount: applied.length,
      failedCount: failed.length,
      skippedCount: skipped.length,
      applied,
      failed,
      skipped,
      summary: summarizeRollMapping(results),
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[students/map-roll-numbers/apply]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
