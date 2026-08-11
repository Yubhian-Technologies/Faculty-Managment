import type { Firestore } from "firebase-admin/firestore";
import type { AcademicRegulationSettings } from "@/types/core";

// colleges/{collegeId}/settings/academicRegulations - the curriculum
// regulation(s) (e.g. R20, R23) the Principal has fixed for each year of study.
export const DEFAULT_ACADEMIC_REGULATIONS: Omit<AcademicRegulationSettings, "updatedAt" | "updatedByName"> = {
  regulations: [],
  yearRegulations: {},
};

export function academicRegulationsRef(db: Firestore, collegeId: string) {
  return db.collection("colleges").doc(collegeId).collection("settings").doc("academicRegulations");
}

export async function loadAcademicRegulations(db: Firestore, collegeId: string): Promise<AcademicRegulationSettings> {
  const snap = await academicRegulationsRef(db, collegeId).get();
  return snap.exists
    ? { ...DEFAULT_ACADEMIC_REGULATIONS, ...(snap.data() as Partial<AcademicRegulationSettings>) }
    : (DEFAULT_ACADEMIC_REGULATIONS as AcademicRegulationSettings);
}
