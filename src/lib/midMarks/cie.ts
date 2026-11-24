import type { Firestore } from "firebase-admin/firestore";
import type { CeaMarksSheet, CeaPlan } from "@/types";
import type { MidMarksSheet } from "@/types/midMarks";
import { ceaMarksCol, internalSubmitted, syncCeaIntoInternal } from "@/lib/cea/marksServer";
import { ceaSheetId } from "@/lib/cea/marks";

// The with-Mid CIE unit entered on a Mid Marks sheet (the CIE part of the same printed paper) follows that sheet:
// reopened with it, and changed only while it is a draft.

/** The CIE unit planned with this Mid for the subject, or null. */
export async function withMidCieUnit(db: Firestore, collegeId: string, subjectId: string, mid: number): Promise<number | null> {
  const plan = (await db.collection("colleges").doc(collegeId).collection("ceaPlans").doc(subjectId).get()).data() as CeaPlan | undefined;
  return plan?.units.find((u) => u.when === `MID${mid}`)?.unit ?? null;
}

/** Puts a submitted with-Mid CIE unit back to a draft (unless the section's internal marks are submitted). */
export async function reopenWithMidCie(db: Firestore, collegeId: string, sheet: Pick<MidMarksSheet, "subjectId" | "midNumber" | "assignmentId">, byName: string, at: string) {
  const unit = await withMidCieUnit(db, collegeId, sheet.subjectId, sheet.midNumber);
  if (!unit || (await internalSubmitted(db, collegeId, sheet.assignmentId))) return;
  const ref = ceaMarksCol(db, collegeId).doc(ceaSheetId(sheet.assignmentId, unit));
  const changed = await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as CeaMarksSheet | undefined;
    if (!cur || cur.status !== "SUBMITTED") return false;
    const next = { ...cur, status: "DRAFT" as const, rev: cur.rev + 1, updatedAt: at, updatedByName: byName };
    delete next.submittedAt;
    tx.set(ref, next);
    return true;
  });
  if (changed) await syncCeaIntoInternal(db, collegeId, sheet.assignmentId);
}

/** Before a Mid sheet is submitted: its with-Mid CIE unit must have every student entered (or absent). Returns the
 *  CIE sheet's id when there is one to submit with it. */
export async function checkWithMidCie(db: Firestore, collegeId: string, sheet: Pick<MidMarksSheet, "subjectId" | "midNumber" | "assignmentId">): Promise<string | null> {
  const unit = await withMidCieUnit(db, collegeId, sheet.subjectId, sheet.midNumber);
  if (!unit) return null;
  const id = ceaSheetId(sheet.assignmentId, unit);
  const cur = (await ceaMarksCol(db, collegeId).doc(id).get()).data() as CeaMarksSheet | undefined;
  if (!cur) throw new Error(`CIE_MISSING:${unit}`);
  if (cur.status === "SUBMITTED") return null;
  const missing = cur.entries.filter((e) => !(e.absent === true || e.marks != null)).length;
  if (missing) throw new Error(`CIE_INCOMPLETE:${unit}:${missing}`);
  return id;
}

/** Submits the with-Mid CIE sheet along with its Mid sheet and feeds internal marks. */
export async function submitWithMidCie(db: Firestore, collegeId: string, ceaId: string, assignmentId: string, byName: string, at: string) {
  const ref = ceaMarksCol(db, collegeId).doc(ceaId);
  await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as CeaMarksSheet | undefined;
    if (!cur || cur.status === "SUBMITTED") return;
    tx.set(ref, { ...cur, status: "SUBMITTED", submittedAt: at, rev: cur.rev + 1, updatedAt: at, updatedByName: byName });
  });
  await syncCeaIntoInternal(db, collegeId, assignmentId);
}
