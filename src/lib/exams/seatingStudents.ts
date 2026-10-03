import type { Firestore } from "firebase-admin/firestore";
import { sectionLabel } from "@/lib/exams/seatingSections";
import type { Section, StudentRecord } from "@/types";
import type { SeatingStudent } from "@/types/examSeating";

// A section's current students (not graduated, with a roll number) shaped for
// a seating plan.
export async function loadSectionStudents(
  db: Firestore,
  collegeId: string,
  section: Section
): Promise<SeatingStudent[]> {
  const snap = await db.collection("colleges").doc(collegeId).collection("students")
    .where("department", "==", section.department)
    .where("section", "==", section.name)
    .where("year", "==", section.year)
    .get();
  const label = sectionLabel(section);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as StudentRecord)
    .filter((st) => st.status !== "GRADUATED" && st.rollNumber)
    .map((st): SeatingStudent => ({ id: st.id, rollNumber: st.rollNumber, name: st.name, sectionId: section.id, sectionLabel: label }));
}
