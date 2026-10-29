import type { Firestore } from "firebase-admin/firestore";
import { engine } from "./wiring";

// The scheduled sweep behind "no answer within the set hours -> goes to the next level". Built to be cheap:
//   - colleges are listed by id only (no document bodies);
//   - per college ONE single-field range query (escalateAt <= now) returns only requests that are really overdue, and
//     ONE equality query picks up approved requests whose attendance update failed earlier - both are auto-indexed;
//   - a college with nothing overdue costs two empty queries and no document reads or writes;
//   - every move is its own transaction that re-checks the request is still pending and still overdue, so running the
//     sweep twice, or at the moment someone decides, can never double-move or undo a decision.

export interface EscalationReport { colleges: number; escalated: number; effectsRetried: number; failedColleges: string[] }

export async function runPermissionEscalation(db: Firestore): Promise<EscalationReport> {
  const report: EscalationReport = { colleges: 0, escalated: 0, effectsRetried: 0, failedColleges: [] };
  const colleges = await db.collection("colleges").select().get();
  const eng = engine(db);
  for (const doc of colleges.docs) {
    report.colleges += 1;
    const ctx = { db, collegeId: doc.id, actorRoles: [] as string[] };
    try {
      report.escalated += (await eng.escalateOverdue(ctx, { collegeId: doc.id })).length;
      report.effectsRetried += await eng.retryFailedEffects(ctx, { collegeId: doc.id });
    } catch (err) {
      console.error("[permission-escalation]", doc.id, err);
      report.failedColleges.push(doc.id);
    }
  }
  return report;
}

