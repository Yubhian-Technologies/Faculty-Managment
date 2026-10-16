export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { editableDepartmentNames } from "@/lib/departments/scope";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { getInChunks } from "@/lib/firestore/inQuery";
import { loadHodStudentScope } from "@/lib/mentoring/access";
import { resolveSelfMentor } from "@/lib/mentoring/selfMentor";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { AVAILABLE_FACULTY_STATUSES } from "@/types";
import type { MentorOption } from "@/types/mentoring";

// The faculty an HOD may pick as a mentor: available (not resigned/retired)
// faculty of the HOD's own departments (sub-departments and managed branches
// included) that have a login, each with how many students they already mentor.
export async function GET() {
  try {
    const session = await requireCollegeMember("HOD");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const { scope } = await loadHodStudentScope(db, session.collegeId, session.uid);
    const departments = [...new Set(editableDepartmentNames(scope))];
    const snaps = await Promise.all(
      departments.map((department) =>
        collegeRef.collection("facultyMembers")
          .where("department", "==", department)
          .where("status", "in", AVAILABLE_FACULTY_STATUSES)
          .get()
      )
    );
    const byUid = new Map<string, Omit<MentorOption, "menteeCount">>();
    for (const snap of snaps) {
      for (const d of snap.docs) {
        const f = d.data() as { legalName?: string; honorific?: string; department?: string; designation?: string; userUid?: string };
        const uid = typeof f.userUid === "string" ? f.userUid : "";
        const name = facultyDisplayName(f);
        if (!uid || !name || byUid.has(uid)) continue;
        byUid.set(uid, { uid, name, department: f.department ?? "", designation: f.designation ?? "" });
      }
    }

    // The HOD may mentor too: their own faculty record is offered even when it is filed outside
    // the departments above (e.g. a Department Office login or a managed branch).
    if (!byUid.has(session.uid)) {
      const self = await resolveSelfMentor(db, session.collegeId, session.uid);
      if (self) byUid.set(session.uid, { uid: session.uid, ...self });
    }

    // Everyone's mentee count in a few batched reads (30 mentors per query, ids only) instead of one
    // count query per mentor.
    const countByUid = new Map<string, number>();
    const menteeDocs = await getInChunks([...byUid.keys()], (chunk) => collegeRef.collection("students").where("mentorUid", "in", chunk).select("mentorUid"));
    for (const d of menteeDocs) {
      const uid = (d.data() as { mentorUid?: string }).mentorUid;
      if (uid) countByUid.set(uid, (countByUid.get(uid) ?? 0) + 1);
    }

    const mentors: MentorOption[] = [...byUid.values()]
      .map((m) => ({ ...m, menteeCount: countByUid.get(m.uid) ?? 0, ...(m.uid === session.uid ? { isSelf: true } : {}) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ mentors });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/mentors GET]");
  }
}
