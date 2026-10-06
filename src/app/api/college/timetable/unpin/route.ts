export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadTimetableContext } from "@/lib/timetable/loadContext";
import { draftFacultyIds, draftRef } from "@/lib/timetable/draftAccess";
import { bumpGuards, lockGuards, sectionGuard } from "@/lib/timetable/guards";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { isTimetableIncharge } from "@/lib/departments/timetableIncharge";
import { matchesCurrentSemester, resolveRequestedSemester } from "@/lib/college/semester";
import type { DraftSlot, TimetableDraft, TimetableSlot } from "@/types";

// "Unlock" a section's pinned periods: live periods placed directly on the published
// timetable (source not GENERATED) show in the draft editor locked, because the draft
// does not own them. This moves each into the draft as an ordinary period and marks the
// live slot as draft-managed, so it can be moved or removed like any other and the next
// publish replaces it normally. Nothing disappears from the live timetable meanwhile.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "PANEL_MEMBER", "COLLEGE_STAFF");
    const body = (await readJsonBody(request)) as { sectionId?: string; semester?: number };
    const sectionId = body.sectionId?.trim();
    if (!sectionId) return NextResponse.json({ error: "sectionId is required" }, { status: 400 });

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const sectionSnap = await collegeRef.collection("sections").doc(sectionId).get();
    if (!sectionSnap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    const section = sectionSnap.data() as { courseId: string; year: number; department?: string };
    const semesterResult = await resolveRequestedSemester(db, session.collegeId, section.courseId, section.year, body.semester ?? null);
    if (!semesterResult.ok) return NextResponse.json({ error: semesterResult.error }, { status: 400 });

    // Same who-may-edit rule as the draft itself.
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!section.department || !canHodEditDepartment(scope, section.department)) {
        return NextResponse.json({ error: "This section isn't in your department" }, { status: 403 });
      }
    } else if (session.role === "PANEL_MEMBER" || session.role === "COLLEGE_STAFF") {
      const ok = await isTimetableIncharge(db, session.collegeId, session.uid, section.courseId, section.year);
      if (!ok) return NextResponse.json({ error: "You are not the Timetable Incharge for this course & year" }, { status: 403 });
    }

    const ctx = await loadTimetableContext(db, session.collegeId, sectionId, semesterResult.semester);
    if (!ctx) return NextResponse.json({ error: "Section not found" }, { status: 404 });
    const dRef = draftRef(db, session.collegeId, sectionId, ctx.currentSemester);
    const guards = [sectionGuard(db, session.collegeId, sectionId)];
    const slotsCol = collegeRef.collection("timetableSlots");

    const result = await db.runTransaction(async (tx) => {
      await lockGuards(tx, guards);
      const [draftSnap, liveSnap] = await Promise.all([tx.get(dRef), tx.get(slotsCol.where("sectionId", "==", sectionId))]);
      const pinned = liveSnap.docs
        .map((d) => ({ id: d.id, ref: d.ref, data: d.data() as TimetableSlot }))
        .filter((s) => s.data.source !== "GENERATED" && matchesCurrentSemester(s.data.semester, ctx.currentSemester));
      if (pinned.length === 0) return { unlocked: 0 };

      // A lab block's 2nd..Nth period is the only field needing recomputing.
      const periodsByKey = new Map<string, Set<number>>();
      for (const s of pinned) {
        const key = `${s.data.assignmentId}|${s.data.day}`;
        periodsByKey.set(key, (periodsByKey.get(key) ?? new Set()).add(s.data.periodNumber));
      }
      const toDraftSlot = (s: TimetableSlot): DraftSlot => ({
        assignmentId: s.assignmentId,
        facultyId: s.facultyId,
        facultyName: s.facultyName,
        subjectId: s.subjectId,
        subjectName: s.subjectName,
        subjectType: ctx.subjectsById.get(s.subjectId)?.type ?? "THEORY",
        day: s.day,
        periodNumber: s.periodNumber,
        isBlockContinuation: periodsByKey.get(`${s.assignmentId}|${s.day}`)?.has(s.periodNumber - 1) ?? false,
      });

      if (draftSnap.exists) {
        const draft = draftSnap.data() as TimetableDraft;
        const have = new Set((draft.slots ?? []).map((s) => `${s.assignmentId}|${s.day}|${s.periodNumber}`));
        const adopted = pinned.map((s) => toDraftSlot(s.data)).filter((s) => !have.has(`${s.assignmentId}|${s.day}|${s.periodNumber}`));
        const slots = [...(draft.slots ?? []), ...adopted];
        tx.update(dRef, { slots, facultyIds: draftFacultyIds(slots) });
      }
      for (const s of pinned) tx.update(s.ref, { source: "GENERATED", isPinned: false, updatedAt: FieldValue.serverTimestamp() });
      bumpGuards(tx, guards, session.uid);
      return { unlocked: pinned.length };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/timetable/unpin POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
