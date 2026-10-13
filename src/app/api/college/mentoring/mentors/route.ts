export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { editableDepartmentNames } from "@/lib/departments/scope";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { loadHodStudentScope } from "@/lib/mentoring/access";
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
    if (departments.length === 0) return NextResponse.json({ mentors: [] });

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

    const counts = await Promise.all(
      [...byUid.keys()].map(async (uid) => {
        const c = await collegeRef.collection("students").where("mentorUid", "==", uid).count().get();
        return [uid, c.data().count] as const;
      })
    );
    const countByUid = new Map(counts);

    const mentors: MentorOption[] = [...byUid.values()]
      .map((m) => ({ ...m, menteeCount: countByUid.get(m.uid) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ mentors });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/mentors GET]");
  }
}
