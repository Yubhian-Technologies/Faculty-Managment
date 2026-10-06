import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { getFacultyIdCandidates } from "@/lib/faculty/resolveFacultyMemberId";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import type { Section } from "@/types";

// Who may manage a section's lab batches: its faculty incharge, or the HOD of its
// department. Shared by the lab-batch routes.
export async function authorizedSection(
  session: { collegeId: string; uid: string; role: string },
  sectionId: string,
): Promise<{ section: Section } | { error: NextResponse }> {
  const db = getAdminDb();
  const snap = await db.collection("colleges").doc(session.collegeId).collection("sections").doc(sectionId).get();
  if (!snap.exists) return { error: NextResponse.json({ error: "Section not found" }, { status: 404 }) };
  const section = { id: snap.id, ...snap.data() } as Section;
  if (session.role === "HOD") {
    const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
    if (!canHodEditDepartment(scope, section.department)) {
      return { error: NextResponse.json({ error: "This section isn't in your department" }, { status: 403 }) };
    }
  } else {
    // A faculty login: only the section they are in charge of. Section.facultyInchargeUid
    // holds their login uid or, on older records, their FacultyMember doc id.
    const candidateIds = await getFacultyIdCandidates(db, session.collegeId, session.uid);
    if (!section.facultyInchargeUid || !candidateIds.includes(section.facultyInchargeUid)) {
      return { error: NextResponse.json({ error: "You are not the faculty incharge of this section" }, { status: 403 }) };
    }
  }
  return { section };
}
