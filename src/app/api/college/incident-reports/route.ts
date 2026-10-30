export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember, isCollegeAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorOf } from "@/lib/audit/actorOf";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import type { IncidentAffectedType, IncidentReport, IncidentStudent, IncidentFaculty } from "@/types";

const MAX_INDIVIDUALS = 500;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 5000;

function toIso(value: unknown): string {
  const d = typeof (value as { toDate?: () => Date })?.toDate === "function"
    ? (value as { toDate: () => Date }).toDate()
    : new Date(value as string);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

// College Office, plus College Admin - whose session role reads "PRINCIPAL"
// (see isCollegeAdmin). A real Principal shares that role but is not let in.
async function requireIncidentAccess() {
  const session = await requireCollegeMember("COLLEGE_OFFICE", "PRINCIPAL");
  if (session.role === "PRINCIPAL" && !isCollegeAdmin(session)) throw new Error("UNAUTHORIZED");
  return session;
}

function cleanIds(value: unknown): string[] | null {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  return Array.from(new Set(value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim())));
}

export async function GET() {
  try {
    const session = await requireIncidentAccess();
    const db = getAdminDb();
    const snap = await db
      .collection("colleges").doc(session.collegeId).collection("incidentReports")
      .orderBy("createdAt", "desc")
      .limit(500)
      .get();
    const reports = snap.docs.map((d) => {
      const data = d.data();
      delete data.viewedBy; // who has opened it is for the Incident Record dot only
      return { ...data, id: d.id, createdAt: toIso(data.createdAt) } as IncidentReport;
    });
    return NextResponse.json({ reports });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/incident-reports GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireIncidentAccess();
    const body = (await readJsonBody(request)) as {
      incidentDate?: string; title?: string; description?: string; studentIds?: unknown; facultyIds?: unknown;
    };

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const incidentDate = typeof body.incidentDate === "string" ? body.incidentDate.trim() : "";
    const studentIds = cleanIds(body.studentIds);
    const facultyIds = cleanIds(body.facultyIds);

    if (!incidentDate || !title || !description) {
      return NextResponse.json({ error: "Incident date, title and description are required" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(incidentDate) || Number.isNaN(new Date(incidentDate).getTime())) {
      return NextResponse.json({ error: "Invalid incident date" }, { status: 400 });
    }
    if (incidentDate > new Date().toISOString().slice(0, 10)) {
      return NextResponse.json({ error: "Incident date cannot be in the future" }, { status: 400 });
    }
    if (title.length > MAX_TITLE) {
      return NextResponse.json({ error: `Title must be at most ${MAX_TITLE} characters` }, { status: 400 });
    }
    if (description.length > MAX_DESCRIPTION) {
      return NextResponse.json({ error: `Description must be at most ${MAX_DESCRIPTION} characters` }, { status: 400 });
    }
    if (studentIds === null || facultyIds === null) {
      return NextResponse.json({ error: "Invalid affected individuals" }, { status: 400 });
    }
    if (studentIds.length + facultyIds.length === 0) {
      return NextResponse.json({ error: "Select at least one affected student or faculty" }, { status: 400 });
    }
    if (studentIds.length + facultyIds.length > MAX_INDIVIDUALS) {
      return NextResponse.json({ error: `At most ${MAX_INDIVIDUALS} individuals per report` }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // The details saved with the report are read here from the records
    // themselves, never taken from the request - the client only names who.
    const students: IncidentStudent[] = [];
    if (studentIds.length > 0) {
      const snaps = await db.getAll(...studentIds.map((id) => collegeRef.collection("students").doc(id)));
      for (const s of snaps) {
        if (!s.exists) {
          return NextResponse.json({ error: "A selected student no longer exists" }, { status: 400 });
        }
        const d = s.data() as { name?: string; rollNumber?: string; course?: string; department?: string; year?: number };
        students.push({
          id: s.id,
          name: d.name ?? "",
          rollNumber: d.rollNumber ?? "",
          course: d.course ?? "",
          department: d.department ?? "",
          year: typeof d.year === "number" ? d.year : null,
        });
      }
    }
    const faculty: IncidentFaculty[] = [];
    if (facultyIds.length > 0) {
      const snaps = await db.getAll(...facultyIds.map((id) => collegeRef.collection("facultyMembers").doc(id)));
      for (const s of snaps) {
        if (!s.exists) {
          return NextResponse.json({ error: "A selected faculty member no longer exists" }, { status: 400 });
        }
        const d = s.data() as { legalName?: string; honorific?: string; employeeId?: string; department?: string };
        faculty.push({
          id: s.id,
          name: facultyDisplayName(d) || d.employeeId || "",
          employeeId: d.employeeId ?? "",
          department: d.department ?? "",
        });
      }
    }

    const affectedType: IncidentAffectedType =
      students.length > 0 && faculty.length > 0 ? "BOTH" : students.length > 0 ? "STUDENT" : "FACULTY";
    const actor = await actorOf(db, session.collegeId, session.uid, session.email);
    const createdAt = new Date();
    const ref = collegeRef.collection("incidentReports").doc();
    await ref.set({
      collegeId: session.collegeId,
      incidentDate,
      title,
      description,
      affectedType,
      students,
      faculty,
      createdBy: actor.uid,
      createdByName: actor.name,
      createdAt,
    });

    await writeAuditLog(db, session.collegeId, {
      action: "INCIDENT_REPORT_CREATED",
      performedBy: actor.uid,
      performedByName: actor.name,
      targetId: ref.id,
      details: { title, affectedType, students: students.length, faculty: faculty.length },
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/incident-reports POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
