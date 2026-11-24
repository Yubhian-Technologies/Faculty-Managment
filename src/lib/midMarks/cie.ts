import type { Firestore } from "firebase-admin/firestore";
import type { CeaMarksSheet, CeaPlan } from "@/types";
import type { MidMarksSheet, MidSheetCie } from "@/types/midMarks";
import { ceaMarksCol } from "@/lib/cea/marksServer";
import { ceaSheetId, isEntered } from "@/lib/cea/marks";

// The with-Mid CIE unit (the CIE part of the same printed paper) is entered on Faculty > CIE Marks like every
// other unit. The Mid Marks sheet only shows it: the marks when entered there, otherwise a pointer to CIE Marks.

/** The CIE unit planned with this Mid for the subject, or null. */
export async function withMidCieUnit(db: Firestore, collegeId: string, subjectId: string, mid: number): Promise<number | null> {
  const plan = (await db.collection("colleges").doc(collegeId).collection("ceaPlans").doc(subjectId).get()).data() as CeaPlan | undefined;
  return plan?.units.find((u) => u.when === `MID${mid}`)?.unit ?? null;
}

/** The with-Mid CIE unit's marks as entered on CIE Marks, for showing on the Mid sheet (null = no such unit). */
export async function cieForMidSheet(db: Firestore, collegeId: string, sheet: Pick<MidMarksSheet, "subjectId" | "midNumber" | "assignmentId">): Promise<MidSheetCie | null> {
  const unit = await withMidCieUnit(db, collegeId, sheet.subjectId, sheet.midNumber);
  if (!unit) return null;
  const cur = (await ceaMarksCol(db, collegeId).doc(ceaSheetId(sheet.assignmentId, unit)).get()).data() as CeaMarksSheet | undefined;
  if (!cur) return { unit, unitMarks: null, status: "NOT_STARTED", entered: 0, total: 0, marks: {} };
  const marks: MidSheetCie["marks"] = {};
  for (const e of cur.entries) if (isEntered(e)) marks[e.studentId] = e.absent ? "AB" : (e.marks as number);
  return { unit, unitMarks: cur.unitMarks, status: cur.status, entered: Object.keys(marks).length, total: cur.entries.length, marks };
}
