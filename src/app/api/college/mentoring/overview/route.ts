export const dynamic = "force-dynamic";

import { FieldPath } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { istDateKey } from "@/lib/attendance/istTime";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import { buildMentoringOverview, type OverviewEntry, type OverviewStudent } from "@/lib/mentoring/overview";

// Mentoring at a glance for the Principal and Vice-Principal - their OWN college only (the college
// comes from the session, never from the request). Counts and categories only: no note, concern
// or outcome text ever leaves this route, so seniority does not open a student's confidential record.
export async function GET() {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // One collection-group read narrowed to this college by the document path
    // (colleges/{id}/students/{sid}/mentoringEntries/{eid}); a path range needs no extra index.
    const prefix = `${collegeRef.path}/students/`;
    const [studentSnap, entrySnap] = await Promise.all([
      collegeRef.collection("students").select("department", "mentorUid", "mentorName", "status").get(),
      db.collectionGroup("mentoringEntries")
        .where(FieldPath.documentId(), ">=", prefix)
        .where(FieldPath.documentId(), "<", `${prefix}`)
        .select("section", "values.categories", "values.status", "values.date", "values.dueDate", "values.weekStart")
        .get(),
    ]);

    const students: OverviewStudent[] = studentSnap.docs.map((d) => {
      const s = d.data() as { department?: string; mentorUid?: string; mentorName?: string; status?: string };
      return { id: d.id, department: s.department ?? "", mentorUid: s.mentorUid || undefined, mentorName: s.mentorName || undefined, status: s.status };
    });
    const str = (x: unknown) => (typeof x === "string" ? x : undefined);
    const entries: OverviewEntry[] = entrySnap.docs.map((d) => {
      const e = d.data() as { section?: string; values?: { categories?: unknown; status?: unknown; date?: unknown; dueDate?: unknown; weekStart?: unknown } };
      const v = e.values ?? {};
      return {
        studentId: d.ref.parent.parent?.id ?? "",
        section: e.section ?? "",
        categories: Array.isArray(v.categories) ? v.categories.filter((c): c is string => typeof c === "string") : undefined,
        status: str(v.status),
        date: str(v.date),
        dueDate: str(v.dueDate),
        weekStart: str(v.weekStart),
      };
    });

    return NextResponse.json({ overview: buildMentoringOverview(students, entries, istDateKey()) });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/overview GET]");
  }
}
