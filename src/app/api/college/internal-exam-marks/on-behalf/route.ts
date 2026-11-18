export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { TeachingAssignment } from "@/types";
import { ensureBatch } from "@/lib/exams/midMarksUploadServer";
import { midEntryFor } from "@/lib/exams/midMarksEntryServer";
import { isCollegeAdminSession, onBehalfState } from "@/lib/exams/onBehalf";
import { MidMarksError } from "@/lib/exams/midMarksRoutes";

// College Admin > Internal Marks > Enter on Behalf (lib/exams/onBehalf.ts).
// GET            -> { departments }                    the departments with current section assignments
// GET ?department -> { assignments }                   that department's current section assignments (subject, section, faculty)
// POST { assignmentId } -> { batch, configuration, sheets, midEntry }   the faculty's marks sheet (created if they never opened it)
// Saving / submitting goes through PATCH /api/college/internal-exam-marks/[id] (its on-behalf path).

function fail(err: unknown, tag: string) {
  const bad = badBodyResponse(err);
  if (bad) return bad;
  if (err instanceof MidMarksError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
  }
  console.error(`[${tag}]`, err);
  return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL");
    if (!isCollegeAdminSession(session)) throw new MidMarksError("Only the College Admin can enter marks on a faculty member's behalf.", 403);
    const db = getAdminDb();
    const college = db.collection("colleges").doc(session.collegeId);
    const department = new URL(request.url).searchParams.get("department");
    if (!department) {
      const depts = await college.collection("departments").select("name", "isActive").get();
      return NextResponse.json({ departments: depts.docs.filter((d) => d.get("isActive") !== false).map((d) => String(d.get("name") ?? "")).filter(Boolean).sort() });
    }
    const snap = await college.collection("teachingAssignments").where("department", "==", department).get();
    const assignments = snap.docs
      .map((d) => ({ ...(d.data() as TeachingAssignment), id: d.id }))
      .filter((a) => !a.isPast && a.sectionId && a.courseId)
      .sort((x, y) => String(x.year).localeCompare(String(y.year)) || String(x.sectionName ?? "").localeCompare(String(y.sectionName ?? "")) || x.subjectName.localeCompare(y.subjectName));
    return NextResponse.json({ assignments });
  } catch (err) {
    return fail(err, "internal-exam-marks/on-behalf GET");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL");
    if (!isCollegeAdminSession(session)) throw new MidMarksError("Only the College Admin can enter marks on a faculty member's behalf.", 403);
    const body = (await readJsonBody(request)) as { assignmentId?: unknown };
    const assignmentId = String(body.assignmentId ?? "");
    if (!assignmentId) throw new MidMarksError("Select the subject and section.");
    const db = getAdminDb();
    const { batch, config } = await ensureBatch(db, session.collegeId, assignmentId);
    const { sheets, states } = await midEntryFor(db, session.collegeId, batch, config);
    const midEntry = Object.fromEntries(Object.entries(states).map(([cid, s]) => [cid, onBehalfState(s, !!sheets[cid])]));
    return NextResponse.json({ batch, configuration: config, sheets, midEntry });
  } catch (err) {
    return fail(err, "internal-exam-marks/on-behalf POST");
  }
}
