export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { editableDepartmentNames, facultyManageableDepartmentNames } from "@/lib/departments/scope";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { getInChunks } from "@/lib/firestore/inQuery";
import { loadHodStudentScope } from "@/lib/mentoring/access";
import { resolveSelfMentor } from "@/lib/mentoring/selfMentor";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { AVAILABLE_FACULTY_STATUSES } from "@/types";
import type { Section } from "@/types";
import type { MentorOption } from "@/types/mentoring";

// The faculty an HOD may pick as a mentor: available (not resigned/retired) faculty with a login, each with
// how many students they already mentor -
//   - of the HOD's own departments (sub-departments and managed branches included), and
//   - of ANY department who teach the students' sections (current teaching assignments): with ?sectionId= that
//     section, else every section whose students this HOD assigns. Such a mentor may take only the students of
//     the sections they teach (lib/mentoring/assignMentor.ts checks it on save).
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const { scope, canAssign } = await loadHodStudentScope(db, session.collegeId, session.uid);
    const departments = [...new Set(facultyManageableDepartmentNames(scope))];
    const sectionId = new URL(request.url).searchParams.get("sectionId")?.trim();
    const snaps = await Promise.all(
      departments.map((department) =>
        collegeRef.collection("facultyMembers")
          .where("department", "==", department)
          .where("status", "in", AVAILABLE_FACULTY_STATUSES)
          .get()
      )
    );
    const byUid = new Map<string, Omit<MentorOption, "menteeCount">>();
    const facultyIdByUid = new Map<string, string>();
    for (const snap of snaps) {
      for (const d of snap.docs) {
        const f = d.data() as { legalName?: string; honorific?: string; department?: string; designation?: string; userUid?: string };
        const uid = typeof f.userUid === "string" ? f.userUid : "";
        const name = facultyDisplayName(f);
        if (!uid || !name || byUid.has(uid)) continue;
        byUid.set(uid, { uid, name, department: f.department ?? "", designation: f.designation ?? "" });
        facultyIdByUid.set(uid, d.id);
      }
    }

    // Faculty of other departments who teach these students: the section asked for, else every section this HOD
    // assigns mentors in.
    let sectionIds: string[] = [];
    if (sectionId) sectionIds = [sectionId];
    else {
      const secDocs = await getInChunks([...new Set(editableDepartmentNames(scope))], (chunk) => collegeRef.collection("sections").where("department", "in", chunk));
      const all = secDocs.map((d) => ({ ...(d.data() as Section), id: d.id }));
      const ok = await Promise.all(all.map((x) => canAssign(x)));
      sectionIds = all.filter((_, i) => ok[i]).map((x) => x.id);
    }
    const taDocs = sectionIds.length
      ? await getInChunks(sectionIds, (chunk) => collegeRef.collection("teachingAssignments").where("sectionId", "in", chunk).select("facultyId", "isPast"))
      : [];
    const teachingIds = new Set<string>();
    for (const d of taDocs) {
      const a = d.data() as { facultyId?: string; isPast?: boolean };
      if (a.facultyId && !a.isPast) teachingIds.add(a.facultyId);
    }
    const knownFacultyIds = new Set(facultyIdByUid.values());
    const outside = [...teachingIds].filter((id) => !knownFacultyIds.has(id));
    const otherDepartment = new Set<string>();
    if (outside.length) {
      const docs = await db.getAll(...outside.map((id) => collegeRef.collection("facultyMembers").doc(id)));
      for (const d of docs) {
        if (!d.exists) continue;
        const f = d.data() as { legalName?: string; honorific?: string; department?: string; designation?: string; userUid?: string; status?: string };
        const uid = typeof f.userUid === "string" ? f.userUid : "";
        const name = facultyDisplayName(f);
        if (!uid || !name || byUid.has(uid) || !(AVAILABLE_FACULTY_STATUSES as string[]).includes(f.status ?? "")) continue;
        byUid.set(uid, { uid, name, department: f.department ?? "", designation: f.designation ?? "" });
        facultyIdByUid.set(uid, d.id);
        otherDepartment.add(uid);
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

    // With ?sectionId=, the faculty who teach that class are flagged: they are the natural mentors.

    const mentors: MentorOption[] = [...byUid.values()]
      .map((m) => ({
        ...m,
        menteeCount: countByUid.get(m.uid) ?? 0,
        ...(m.uid === session.uid ? { isSelf: true } : {}),
        ...(sectionId ? { teaches: teachingIds.has(facultyIdByUid.get(m.uid) ?? "") } : {}),
        ...(otherDepartment.has(m.uid) ? { otherDepartment: true } : {}),
      }))
      .sort((a, b) => Number(b.teaches ?? false) - Number(a.teaches ?? false) || a.name.localeCompare(b.name));
    return NextResponse.json({ mentors });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/mentors GET]");
  }
}
