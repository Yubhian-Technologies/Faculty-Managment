export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorOf } from "@/lib/audit/actorOf";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { bulkUpdatesOf, classifyRowAgainstStudent, summarizeBulkUpdate, type BulkUpdateResult } from "@/lib/students/bulkUpdate";
import { MAX_BULK_APPLY_ROWS, parseBulkUpdateRequest } from "@/lib/students/bulkUpdateRows";
import { resolveBulkUpdate } from "@/lib/students/bulkUpdateResolve";
import { normalizeStudentMobile } from "@/lib/students/studentMobile";

const RUN_ID = /^[A-Za-z0-9_-]{8,64}$/;

// Applies an "Update student data" file, one student at a time. The page sends the file in chunks of at most
// MAX_BULK_APPLY_ROWS rows, all carrying the same runId (the id of the run's backup document).
//
// Safety, in order:
//  - The rows are re-resolved and re-classified here on fresh data; the preview is never trusted.
//  - Each student is ONE transaction: re-read, re-classify against what is stored right now, then write ONLY the changed
//    fields and the backup row (old and new value of every field it changed) together. A crash cannot leave a change
//    without its backup. A value someone changed since the preview is judged against the current value.
//  - Only the allow-listed detail fields are ever written - never Student Mobile No, Roll No, name, department, year,
//    section, status, the mobile/roll registries or the login.
//  - One student failing is reported and the rest continue.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("COLLEGE_OFFICE");

    let body: { rows?: unknown; fields?: unknown; fillOnly?: unknown; runId?: unknown; fileName?: unknown };
    try {
      body = (await readJsonBody(request)) as typeof body;
    } catch (err) {
      return badBodyResponse(err) ?? NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const parsed = parseBulkUpdateRequest(body, MAX_BULK_APPLY_ROWS);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    if (typeof body.runId !== "string" || !RUN_ID.test(body.runId)) return NextResponse.json({ error: "Invalid run id" }, { status: 400 });
    const runId = body.runId;
    const fileName = typeof body.fileName === "string" ? body.fileName.slice(0, 200) : "";

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const runRef = collegeRef.collection("studentBulkUpdates").doc(runId);
    const actor = await actorOf(db, session.collegeId, session.uid, session.email);

    const results = await resolveBulkUpdate(db, session.collegeId, parsed.rows, parsed.fields, parsed.fillOnly);
    const toWrite = results.filter((r) => r.outcome === "WILL_UPDATE" && r.studentId);

    const applied: BulkUpdateResult[] = [];
    const failed: (BulkUpdateResult & { error: string })[] = [];
    const settled: BulkUpdateResult[] = []; // judged again on fresh data inside the transaction and found nothing to do
    const rowByNumber = new Map(parsed.rows.map((r) => [r.rowNumber, r]));

    for (const result of toWrite) {
      const row = rowByNumber.get(result.rowNumber)!;
      const studentRef = collegeRef.collection("students").doc(result.studentId!);
      const backupRef = runRef.collection("rows").doc(result.studentId!);
      try {
        const outcome = await db.runTransaction(async (tx) => {
          const [snap, backup] = await Promise.all([tx.get(studentRef), tx.get(backupRef)]);
          if (!snap.exists) return { kind: "gone" as const };
          const data = snap.data() as Record<string, unknown>;
          if (normalizeStudentMobile(data.mobileNo) !== result.mobileNormalized) return { kind: "moved" as const };
          const fresh = classifyRowAgainstStudent(row, { id: snap.id, data }, { fields: parsed.fields, fillOnly: parsed.fillOnly });
          if (fresh.outcome !== "WILL_UPDATE") return { kind: "settled" as const, fresh };

          const before: Record<string, unknown> = {};
          const after: Record<string, unknown> = {};
          for (const c of fresh.changes) { before[c.key] = c.beforeValue ?? null; after[c.key] = c.afterValue; }
          // Same student twice in one run (a re-sent chunk): keep the ORIGINAL old value, never the intermediate one.
          const earlier = backup.exists ? (backup.get("before") as Record<string, unknown> | undefined) ?? {} : {};

          tx.update(studentRef, { ...bulkUpdatesOf(fresh.changes), updatedAt: new Date() });
          tx.set(backupRef, {
            studentId: snap.id,
            fileRow: row.rowNumber,
            mobile: result.mobileNormalized,
            studentName: typeof data.name === "string" ? data.name : "",
            rollNumber: typeof data.rollNumber === "string" ? data.rollNumber : "",
            before: { ...before, ...earlier },
            after: { ...(backup.exists ? (backup.get("after") as Record<string, unknown> | undefined) ?? {} : {}), ...after },
            appliedAt: new Date(),
          });
          return { kind: "applied" as const, fresh, name: typeof data.name === "string" ? data.name : "", roll: typeof data.rollNumber === "string" ? data.rollNumber : "" };
        });

        if (outcome.kind === "gone") { failed.push({ ...result, error: "That student no longer exists" }); continue; }
        if (outcome.kind === "moved") { failed.push({ ...result, error: "This student's mobile number changed since the check - re-check the file" }); continue; }
        if (outcome.kind === "settled") { settled.push({ ...result, ...outcome.fresh }); continue; }

        applied.push({ ...result, ...outcome.fresh });
        await writeAuditLogSafe(db, session.collegeId, {
          action: "STUDENT_DETAILS_UPDATED",
          performedBy: session.uid,
          performedByName: actor.name,
          targetId: result.studentId!,
          details: {
            name: outcome.name,
            rollNumber: outcome.roll,
            via: "Bulk Update Students",
            runId,
            fileRow: row.rowNumber,
            fields: outcome.fresh.changes.map((c) => c.key),
          },
        });
      } catch (err) {
        failed.push({ ...result, error: err instanceof Error ? err.message : "Could not update this student" });
      }
    }

    const skipped = [...results.filter((r) => r.outcome !== "WILL_UPDATE" || !r.studentId), ...settled];

    // The run's own record, merged across chunks. Best effort: the per-student backup rows above are what protect data.
    try {
      await runRef.set(
        {
          collegeId: session.collegeId,
          performedBy: session.uid,
          performedByName: actor.name,
          fileName,
          fields: parsed.fields,
          fillOnly: parsed.fillOnly,
          updatedAt: new Date(),
          appliedCount: FieldValue.increment(applied.length),
          failedCount: FieldValue.increment(failed.length),
          skippedCount: FieldValue.increment(skipped.length),
        },
        { merge: true }
      );
    } catch (err) {
      console.error("[students/bulk-update/apply] run record", err);
    }

    return NextResponse.json({
      runId,
      appliedCount: applied.length,
      failedCount: failed.length,
      skippedCount: skipped.length,
      applied,
      failed,
      skipped,
      summary: summarizeBulkUpdate(results),
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[students/bulk-update/apply]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
