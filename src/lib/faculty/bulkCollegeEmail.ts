import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { CollegeEmailError, changeFacultyCollegeEmail } from "@/lib/faculty/changeCollegeEmail";
import {
  ALREADY_SAME_MESSAGE, ROW_ERROR, bulkFailure, validateBulkRows,
  type BulkInputRow, type BulkRowResult,
} from "@/lib/faculty/bulkCollegeEmailRows";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";

// Bulk "Change College Email" (College Office > Faculty > Bulk Update College Emails): each row is an Employee ID and the
// new college email. EVERY row goes through changeFacultyCollegeEmail - the exact same function, checks and side effects as
// the single Change College Email button (all copies updated together, old address kept in history, signed out on every
// device, in-app notification only) - so the rules cannot drift apart. A bad row never affects another row.

/** Rows one request may carry. Each row makes several Auth + Firestore calls, so the page sends small chunks. */
export const BULK_COLLEGE_EMAIL_MAX_ROWS_PER_CALL = 50;

export type BulkCollegeEmailRecord = BulkInputRow;

export interface BulkCollegeEmailOutcome {
  results: BulkRowResult[];
  updated: number;
  unchanged: number;
  failed: number;
}

/** The faculty record(s) of this college holding this Employee ID (compared case-insensitively - IDs are stored as typed). */
async function findFacultyByEmployeeId(db: Firestore, collegeId: string, employeeId: string) {
  const variants = Array.from(new Set([employeeId, employeeId.toUpperCase(), employeeId.toLowerCase()]));
  const snap = await db.collection("colleges").doc(collegeId).collection("facultyMembers").where("employeeId", "in", variants).limit(5).get();
  return snap.docs.filter((d) => String((d.data() as { employeeId?: string }).employeeId ?? "").trim().toLowerCase() === employeeId.toLowerCase());
}

export async function bulkChangeCollegeEmails(
  db: Firestore, auth: Auth,
  input: { collegeId: string; actor: { uid: string; name?: string }; records: BulkCollegeEmailRecord[] },
): Promise<BulkCollegeEmailOutcome> {
  const { collegeId, actor, records } = input;
  const { ok, rejected } = validateBulkRows(records);
  const results: BulkRowResult[] = [...rejected];

  // Strictly one row after another: each makes Auth + Firestore writes that must not interleave.
  for (const row of ok) {
    const { fileRow, employeeId, newEmail } = row;
    try {
      const matches = await findFacultyByEmployeeId(db, collegeId, employeeId);
      if (matches.length === 0) { results.push(bulkFailure(fileRow, employeeId, "NOT_FOUND", ROW_ERROR.NOT_FOUND, { newEmail })); continue; }
      if (matches.length > 1) { results.push(bulkFailure(fileRow, employeeId, "AMBIGUOUS", ROW_ERROR.AMBIGUOUS, { newEmail })); continue; }
      const doc = matches[0];
      const stored = (doc.data() as { employeeId?: string }).employeeId ?? employeeId;

      const r = await changeFacultyCollegeEmail(db, auth, { collegeId, facultyId: doc.id, expectedEmployeeId: stored, newEmail, actor });
      if (r.changed) {
        results.push({
          fileRow, employeeId: stored, status: "UPDATED", oldEmail: r.oldEmail, newEmail: r.newEmail,
          message: r.signedOut ? "Updated - signed out on all devices" : "Updated (this faculty member has no login yet)",
        });
      } else {
        results.push({ fileRow, employeeId: stored, status: "UNCHANGED", oldEmail: r.oldEmail, newEmail: r.newEmail, message: ALREADY_SAME_MESSAGE });
      }
    } catch (err) {
      if (err instanceof CollegeEmailError) {
        results.push(bulkFailure(fileRow, employeeId, err.code, err.message, { newEmail }));
      } else {
        console.error("[bulkChangeCollegeEmails] row failed", employeeId, err);
        results.push(bulkFailure(fileRow, employeeId, "ERROR", "Could not be updated - nothing was changed for this row, try it again", { newEmail }));
      }
    }
  }

  results.sort((a, b) => a.fileRow - b.fileRow);
  const updated = results.filter((r) => r.status === "UPDATED").length;
  const unchanged = results.filter((r) => r.status === "UNCHANGED").length;
  const failed = results.filter((r) => r.status === "FAILED").length;
  await writeAuditLogSafe(db, collegeId, {
    action: "FACULTY_COLLEGE_EMAIL_BULK_IMPORT", performedBy: actor.uid, performedByName: actor.name,
    details: { rows: records.length, updated, unchanged, failed },
  });
  return { results, updated, unchanged, failed };
}
