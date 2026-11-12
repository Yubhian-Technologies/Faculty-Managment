import type { Firestore } from "firebase-admin/firestore";
import type { ExamMidSettings, MidAssignment, MidOutcomeSwitches, MidPreparation } from "@/types/examMidSchedule";
import { outcomeSwitches } from "@/lib/midBank/outcomeSwitches";
import { bloomLevelsOf, type BloomLevelDef } from "@/lib/midBank/bloom";

// The college's Mid settings (colleges/{c}/examSettings/mid) as every Mid route reads them: how many Mids, how
// faculty prepare them (question bank or question papers) and which academic tags questions carry.

export const midSettingsRef = (db: Firestore, collegeId: string) =>
  db.collection("colleges").doc(collegeId).collection("examSettings").doc("mid");

export interface MidSettings { midCount: number; midPreparation: MidPreparation; midAssignment: MidAssignment; outcomes: MidOutcomeSwitches; bloomLevels: BloomLevelDef[]; printPo: boolean }

export function readMidSettings(data: Partial<ExamMidSettings> | undefined): MidSettings {
  return {
    midCount: Number(data?.midCount) || 0,
    midPreparation: data?.midPreparation === "PAPERS" ? "PAPERS" : "BANK",
    midAssignment: data?.midAssignment === "HOD" ? "HOD" : "SELF",
    outcomes: outcomeSwitches(data?.outcomes),
    bloomLevels: bloomLevelsOf(data?.bloomLevels),
    printPo: data?.printPo === true,
  };
}

export async function loadMidSettings(db: Firestore, collegeId: string): Promise<MidSettings> {
  const snap = await midSettingsRef(db, collegeId).get();
  return readMidSettings(snap.data() as Partial<ExamMidSettings> | undefined);
}
