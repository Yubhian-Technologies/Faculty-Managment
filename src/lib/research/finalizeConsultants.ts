import type { Firestore } from "firebase-admin/firestore";
import type { ConsultancyFacultyConsultant } from "@/types";

export type ConsultantFields = {
  facultyConsultants: ConsultancyFacultyConsultant[];
  facultyConsultantsCount: number | null;
  facultyConsultantsNames: string;
};

// Resolves submitted Employee IDs against this college's facultyMembers so a
// consultant's name always comes from the real record, never from whatever the
// client sent. Blank and repeated IDs are dropped. Returns `error` naming the
// first ID that matches nobody.
export async function finalizeFacultyConsultants(
  db: Firestore, collegeId: string, facultyIds: string[]
): Promise<{ fields: ConsultantFields } | { error: string }> {
  const ids = [...new Set(facultyIds.map((v) => String(v ?? "").trim()).filter(Boolean))];
  const consultants: ConsultancyFacultyConsultant[] = [];
  for (const facultyId of ids) {
    const snap = await db.collection("colleges").doc(collegeId).collection("facultyMembers")
      .where("employeeId", "==", facultyId).limit(1).get();
    const f = snap.docs[0]?.data() as { name?: string; legalName?: string } | undefined;
    if (!f) return { error: `No faculty member found with Faculty ID "${facultyId}"` };
    consultants.push({ facultyId, name: f.name || f.legalName || facultyId });
  }
  return {
    fields: {
      facultyConsultants: consultants,
      facultyConsultantsCount: consultants.length || null,
      facultyConsultantsNames: consultants.map((c) => c.name).join(", "),
    },
  };
}
