import type { StudentRecord } from "@/types";
import type { MenteeSummary } from "@/types/mentoring";

/** The few fields a mentoring list shows - never the whole roster record. */
export function toMenteeSummary(s: Pick<StudentRecord, "id" | "name" | "rollNumber" | "department" | "section" | "year" | "mentorUid" | "mentorName" | "profilePhotoUrl"> & { status?: string }): MenteeSummary {
  return {
    id: s.id,
    name: s.name ?? "",
    rollNumber: s.rollNumber ?? "",
    department: s.department ?? "",
    section: s.section ?? "",
    year: s.year,
    status: s.status ?? "REGULAR",
    ...(s.profilePhotoUrl ? { profilePhotoUrl: s.profilePhotoUrl } : {}),
    ...(s.mentorUid ? { mentorUid: s.mentorUid } : {}),
    ...(s.mentorName ? { mentorName: s.mentorName } : {}),
  };
}
