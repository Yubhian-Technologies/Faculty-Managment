export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { batchNotify } from "@/lib/notify";
import { paymentErrorResponse } from "@/lib/payments/server";
import { requireFeesManager } from "@/lib/fees/http";
import { FeeError, raiseFees } from "@/lib/fees/server";
import { ACADEMIC_YEAR_RE } from "@/lib/fees/rules";

// Accounts > Fees > Raise Fees (?collegeId): POST { academicYear, courseKey, batch, apply } - every current student
// of the course + batch gets the year's fee from the published structure of their admission type (else the batch's
// "ALL" one). apply false = preview, nothing written. Accounts with payments are never changed.
export async function POST(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireFeesManager(db, request);
    const body = (await readJsonBody(request)) as { academicYear?: unknown; courseKey?: unknown; batch?: unknown; apply?: unknown };
    const academicYear = String(body.academicYear ?? ""), courseKey = String(body.courseKey ?? ""), batch = String(body.batch ?? "");
    if (!ACADEMIC_YEAR_RE.test(academicYear) || !courseKey || !batch) throw new FeeError("Select the academic year, course and batch.");
    const apply = body.apply === true;
    const rows = await raiseFees(db, session.collegeId, { academicYear, courseKey, batch, apply, byName: session.byName });
    if (apply) {
      const counts = Object.fromEntries(["NEW", "UPDATED", "KEPT", "NO_STRUCTURE"].map((k) => [k, rows.filter((r) => r.outcome === k).length]));
      await writeAuditLogSafe(db, session.collegeId, { action: "FEES_RAISED", performedBy: session.uid, performedByName: session.byName, targetId: `${academicYear}__${batch}`, details: { academicYear, courseKey, batch, ...counts } });
      // Tell the students whose fee was raised (those with a login).
      const accounts = rows.filter((r) => r.outcome === "NEW");
      if (accounts.length) {
        const uids = (await db.getAll(...accounts.map((r) => db.collection("colleges").doc(session.collegeId).collection("students").doc(r.studentId))))
          .map((s) => s.get("uid") as string | undefined).filter((x): x is string => !!x);
        if (uids.length) await batchNotify(db, session.collegeId, uids, "GENERAL", "Fees for " + academicYear, `Your fees for ${academicYear} are now listed. See Fees for the amount and due dates.`, "/student/fees").catch(() => undefined);
      }
    }
    return NextResponse.json({ rows });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/raise POST]");
  }
}
