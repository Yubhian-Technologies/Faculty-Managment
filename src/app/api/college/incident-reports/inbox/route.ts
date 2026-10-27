export const dynamic = "force-dynamic";

// Read-only Incident Record for the people an incident is reported TO:
// Principal, Vice Principal, Dean Academics (ACADEMICS) and the HOD of the
// affected individuals' department. Reports are written by College Office /
// College Admin through ../route.ts. Who has opened a report is kept on the
// report as `viewedBy` (uids) - the red "new" dot is simply "my uid is not in it".

import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import type { IncidentAffectedType, IncidentReport } from "@/types";

function toIso(value: unknown): string {
  const d = typeof (value as { toDate?: () => Date })?.toDate === "function"
    ? (value as { toDate: () => Date }).toDate()
    : new Date(value as string);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function unauthorized(err: unknown) {
  return err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT");
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "ACADEMICS", "HOD");
    const countOnly = new URL(request.url).searchParams.get("count") === "1";
    const db = getAdminDb();

    // An HOD only sees the people from their own department(s) (own + its
    // sub-departments), and only the reports that involve at least one of them.
    let hodDepartments: Set<string> | null = null;
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid, { activeOnly: false });
      hodDepartments = new Set([...scope.ownDepartmentNames, ...scope.childDepartmentNames]);
    }

    const snap = await db
      .collection("colleges").doc(session.collegeId).collection("incidentReports")
      .orderBy("createdAt", "desc")
      .limit(500)
      .get();

    const reports: IncidentReport[] = [];
    for (const d of snap.docs) {
      const data = d.data() as Omit<IncidentReport, "id" | "unread" | "createdAt"> & { createdAt: unknown; viewedBy?: string[] };
      let students = data.students ?? [];
      let faculty = data.faculty ?? [];
      let affectedType: IncidentAffectedType = data.affectedType;
      if (hodDepartments) {
        students = students.filter((s) => hodDepartments.has(s.department));
        faculty = faculty.filter((f) => hodDepartments.has(f.department));
        if (students.length + faculty.length === 0) continue;
        affectedType = students.length > 0 && faculty.length > 0 ? "BOTH" : students.length > 0 ? "STUDENT" : "FACULTY";
      }
      const { viewedBy, ...rest } = data;
      reports.push({
        ...rest,
        id: d.id,
        students,
        faculty,
        affectedType,
        createdAt: toIso(data.createdAt),
        unread: !(viewedBy ?? []).includes(session.uid),
      });
    }

    const unreadCount = reports.filter((r) => r.unread).length;
    return NextResponse.json(countOnly ? { unreadCount } : { reports, unreadCount });
  } catch (err) {
    if (unauthorized(err)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[college/incident-reports/inbox GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Marks one report as viewed by the caller - clears their red dot for it.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "ACADEMICS", "HOD");
    const body = (await readJsonBody(request)) as { id?: string };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const ref = getAdminDb()
      .collection("colleges").doc(session.collegeId).collection("incidentReports").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    await ref.update({ viewedBy: FieldValue.arrayUnion(session.uid) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (unauthorized(err)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[college/incident-reports/inbox POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
