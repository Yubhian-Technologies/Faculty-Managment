import type { Firestore } from "firebase-admin/firestore";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { AVAILABLE_FACULTY_STATUSES } from "@/types";

export interface SelfMentor { name: string; department: string; designation: string }

// The HOD as a mentor for themselves. Their faculty record is used when they have one (and only
// while it is available - a resigned/retired person is read-only and mentors nobody). A Principal /
// Vice Principal who also holds an HOD seat often has NO faculty record linked to their login; they
// are still offered, under the name on their login, so holding a higher post never removes them
// from the list.
export async function resolveSelfMentor(db: Firestore, collegeId: string, uid: string): Promise<SelfMentor | null> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const facSnap = await collegeRef.collection("facultyMembers").where("userUid", "==", uid).limit(1).get();
  const f = facSnap.docs[0]?.data() as { legalName?: string; honorific?: string; department?: string; designation?: string; status?: string } | undefined;
  if (f) {
    const name = facultyDisplayName(f);
    if (!name || !(AVAILABLE_FACULTY_STATUSES as string[]).includes(f.status ?? "")) return null;
    return { name, department: f.department ?? "", designation: f.designation ?? "" };
  }
  const userSnap = await collegeRef.collection("users").doc(uid).get();
  const u = userSnap.data() as { name?: string; designation?: string; isActive?: boolean } | undefined;
  const name = u?.name?.trim() ?? "";
  if (!u || !name || u.isActive === false) return null;
  return { name, department: "", designation: u.designation ?? "" };
}
