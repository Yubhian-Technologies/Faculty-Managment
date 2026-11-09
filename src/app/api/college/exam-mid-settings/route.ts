export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { ExamMidSettings, MidOutcomeSwitches } from "@/types";
import { loadMidSettings, midSettingsRef, readMidSettings } from "@/lib/exams/midSettings";
import { outcomeSwitches } from "@/lib/midBank/outcomeSwitches";
import { isDeadlineLocked } from "@/lib/midBank/deadline";
import { cleanBloomLevels } from "@/lib/midBank/bloom";

// colleges/{collegeId}/examSettings/mid - single college-wide doc.
// HOD / timetable incharges read the mid count for the flexible-cell dialog (read-only; saving stays with the Exam Cell).
const READ_ROLES = ["EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "HOD", "PANEL_MEMBER", "COLLEGE_STAFF"];

export async function GET() {
  try {
    const session = await requireCollegeMember(...READ_ROLES);
    const db = getAdminDb();
    const snap = await db
      .collection("colleges").doc(session.collegeId).collection("examSettings").doc("mid")
      .get();
    const settings: ExamMidSettings = snap.exists ? (snap.data() as ExamMidSettings) : { midCount: 0 };
    // midPreparation / outcomes as every Mid route reads them (missing = question bank, all tags on).
    const resolved = readMidSettings(settings);
    return NextResponse.json({ settings: { ...settings, midPreparation: resolved.midPreparation, midAssignment: resolved.midAssignment, outcomes: resolved.outcomes, bloomLevels: resolved.bloomLevels } });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-mid-settings GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL", "SUPER_ADMIN");
    const body = (await readJsonBody(request)) as { midCount?: number; midPreparation?: unknown; midAssignment?: unknown; outcomes?: unknown; bloomLevels?: unknown };
    const db = getAdminDb();
    const current = await loadMidSettings(db, session.collegeId);
    // Any field left out keeps its saved value (the Mid count card and the preparation card save separately).
    const midCount = body.midCount === undefined ? current.midCount : Number(body.midCount);
    if (!Number.isInteger(midCount) || midCount < 1 || midCount > 10) {
      return NextResponse.json({ error: "Mid count must be an integer between 1 and 10" }, { status: 400 });
    }
    const midPreparation = body.midPreparation === undefined ? current.midPreparation : body.midPreparation === "PAPERS" ? "PAPERS" : "BANK";
    const midAssignment = body.midAssignment === undefined ? current.midAssignment : body.midAssignment === "HOD" ? "HOD" : "SELF";
    const outcomes = body.outcomes === undefined ? current.outcomes : outcomeSwitches(body.outcomes as Partial<MidOutcomeSwitches>);
    // The college's Bloom's levels (names + per-unit minimums). Banks / papers already started keep their own copy.
    let bloomLevels = current.bloomLevels;
    if (body.bloomLevels !== undefined) {
      const clean = cleanBloomLevels(body.bloomLevels);
      if (clean.errors.length) return NextResponse.json({ error: clean.errors[0], errors: clean.errors }, { status: 400 });
      bloomLevels = clean.value;
    }

    // Switching bank <-> papers while faculty are preparing under an open deadline would strand their work.
    if (midPreparation !== current.midPreparation || midAssignment !== current.midAssignment) {
      const college = db.collection("colleges").doc(session.collegeId);
      const open = (await college.collection("midBankDeadlines").get()).docs.filter((d) => !isDeadlineLocked(d.get("deadline") as string)).map((d) => d.id);
      for (const id of open) {
        const [banks, sets] = await Promise.all([
          college.collection("midQuestionBanks").where("deadlineId", "==", id).limit(1).get(),
          college.collection("midPaperSets").where("deadlineId", "==", id).limit(1).get(),
        ]);
        if (!banks.empty || !sets.empty) {
          return NextResponse.json({ error: "Faculty are already preparing for an open deadline - switch after it ends (or move the deadline)" }, { status: 409 });
        }
      }
    }

    const actorSnap = await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? "Exam Cell";

    const settings: ExamMidSettings = {
      midCount, midPreparation, midAssignment, outcomes, bloomLevels,
      updatedAt: new Date() as unknown as ExamMidSettings["updatedAt"],
      updatedByName: actorName,
    };
    await midSettingsRef(db, session.collegeId).set(settings, { merge: true });

    return NextResponse.json({ settings });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/exam-mid-settings PUT]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
