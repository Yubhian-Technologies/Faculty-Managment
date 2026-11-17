export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { courseIdsForKey } from "@/lib/midBank/server";
import { MID_MARKS_MODES, type MidMarksMode } from "@/lib/exams/midMarksEntry";
import { loadMode, midMarksExist, modeDocId, modesCol } from "@/lib/exams/midMarksEntryServer";

// Who enters a Mid's marks, per course + Mid (lib/exams/midMarksEntry.ts): FACULTY (default) | EXAM_CELL.
// GET -> { modes: [{ courseKey, courseName, midNumber, mode }] }   (only the ones set; missing = FACULTY)
// PUT { courseKey, courseName, midNumber, mode } - refused (409) once marks of that Mid exist for the course.
const READERS = ["EXAM_CELL", "SUPER_ADMIN", "PRINCIPAL", "VICE_PRINCIPAL"];
const WRITERS = ["EXAM_CELL", "SUPER_ADMIN"];

function fail(err: unknown, tag: string) {
  const bad = badBodyResponse(err);
  if (bad) return bad;
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
  }
  console.error(`[${tag}]`, err);
  return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
}

export async function GET() {
  try {
    const session = await requireCollegeMember(...READERS);
    const snap = await modesCol(getAdminDb(), session.collegeId).get();
    return NextResponse.json({ modes: snap.docs.map((d) => d.data()) });
  } catch (err) {
    return fail(err, "mid-marks-entry GET");
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember(...WRITERS);
    const body = (await readJsonBody(request)) as { courseKey?: unknown; courseName?: unknown; midNumber?: unknown; mode?: unknown };
    const courseKey = typeof body.courseKey === "string" ? body.courseKey.trim() : "";
    const midNumber = Number(body.midNumber);
    const mode = body.mode as MidMarksMode;
    if (!courseKey) return NextResponse.json({ error: "Select a course." }, { status: 400 });
    if (!Number.isInteger(midNumber) || midNumber < 1 || midNumber > 6) return NextResponse.json({ error: "Select a Mid." }, { status: 400 });
    if (!MID_MARKS_MODES.includes(mode)) return NextResponse.json({ error: "Select who enters the marks." }, { status: 400 });

    const db = getAdminDb();
    const before = await loadMode(db, session.collegeId, courseKey, midNumber);
    if (before === mode) return NextResponse.json({ ok: true, mode });
    const { ids, name } = await courseIdsForKey(db, session.collegeId, courseKey);
    if (await midMarksExist(db, session.collegeId, ids, midNumber)) {
      return NextResponse.json({ error: `Marks of Mid-${midNumber} are already entered for ${name || "this course"}, so who enters them can't change now.` }, { status: 409 });
    }
    const actor = (await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get()).data() as { name?: string } | undefined;
    await modesCol(db, session.collegeId).doc(modeDocId(courseKey, midNumber)).set({
      courseKey, courseName: typeof body.courseName === "string" ? body.courseName : name, midNumber, mode,
      updatedAt: new Date(), updatedBy: session.uid, updatedByName: actor?.name ?? "",
    });
    await writeAuditLogSafe(db, session.collegeId, {
      action: "MID_MARKS_ENTRY_CHANGED", performedBy: session.uid, performedByName: actor?.name, targetId: modeDocId(courseKey, midNumber),
      details: { courseKey, midNumber, from: before, to: mode },
    });
    return NextResponse.json({ ok: true, mode });
  } catch (err) {
    return fail(err, "mid-marks-entry PUT");
  }
}
