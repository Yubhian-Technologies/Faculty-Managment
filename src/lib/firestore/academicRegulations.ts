import type { Firestore } from "firebase-admin/firestore";
import type { AcademicRegulationSettings } from "@/types/core";

// colleges/{collegeId}/settings/academicRegulations - the college-wide
// curriculum regulation codes (e.g. R20, R23) in use. Which ones apply to a
// given course, and to which of its years, lives on that course's own Course
// Catalog entry instead (see types/core.ts's AcademicRegulationSettings).
export const DEFAULT_ACADEMIC_REGULATIONS: Omit<AcademicRegulationSettings, "updatedAt" | "updatedByName"> = {
  regulations: [],
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
