import type { Firestore } from "firebase-admin/firestore";
import type { FacultyNorms } from "@/types/core";

// colleges/{collegeId}/settings/general - per-college basic info (faculty
// norms + the leave module's new-joining conversion threshold). Replaces the
// old platform-wide platformConfig/facultyNorms singleton.
export const DEFAULT_COLLEGE_SETTINGS: Omit<FacultyNorms, "updatedAt" | "updatedByName"> = {
  regulatoryBody: "UGC",
  studentFacultyRatio: 15,
  teachingHoursPerWeek: 16,
  defaultMinFacultyPerDept: 3,
  minimumQualifications: {
    assistantProfessor: "M.Phil / NET / Ph.D",
    associateProfessor: "Ph.D with NET",
    professor: "Ph.D with 10 years experience",
  },
  positionNorms: [
    { designation: "Professor", minQualification: "Ph.D", minExperienceYears: 10, requiredPerDept: 1 },
    { designation: "Associate Professor", minQualification: "Ph.D", minExperienceYears: 5, requiredPerDept: 2 },
    { designation: "Assistant Professor", minQualification: "M.Phil / NET", minExperienceYears: 0, requiredPerDept: 3 },
  ],
  newJoiningYears: 1,
};

export function collegeSettingsRef(db: Firestore, collegeId: string) {
  return db.collection("colleges").doc(collegeId).collection("settings").doc("general");
}

export async function loadCollegeSettings(db: Firestore, collegeId: string): Promise<FacultyNorms> {
  const snap = await collegeSettingsRef(db, collegeId).get();
  return snap.exists
    ? { ...DEFAULT_COLLEGE_SETTINGS, ...(snap.data() as Partial<FacultyNorms>) }
    : (DEFAULT_COLLEGE_SETTINGS as FacultyNorms);
}
