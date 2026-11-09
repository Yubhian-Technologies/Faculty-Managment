export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { outcomeConflicts } from "@/lib/midBank/outcomes";
import { actorName, guardError, loadSubject, usedOutcomeRefs } from "@/lib/midBank/server";
import { HISTORY_MAX, cleanSyllabus, syllabusChanges, syllabusOutcomesId, syllabusStep, type SyllabusAction, type SyllabusActor } from "@/lib/subjects/syllabus";
import { ACADEMICS_ROLES, SYLLABUS_READ_ROLES, loadSyllabus, notifyAcademics, notifyHods, syllabusCol, syllabusRoleOf } from "@/lib/subjects/syllabusServer";
import type { SubjectSyllabus, SyllabusHistoryEntry } from "@/types";

// A subject's syllabus content - units, COs (each in a unit), CO -> PO/PSO ticks (lib/subjects/syllabus.ts):
//   GET                 the syllabus + what the caller may do (HOD of the Subject Department / Academics / readers).
//   PUT  { units, cos, mapping, baseVersion }   save: the HOD while it is theirs (draft / returned); Academics once
//                       frozen - recorded in the history field by field, never removing a unit / CO questions use.
//   POST { action: "SUBMIT" | "FREEZE" | "RETURN", remarks?, baseVersion }   HOD submits; Academics freezes or returns.

type Params = { params: Promise<{ id: string }> };

async function context(subjectId: string, roles: string[]) {
  const session = await requireCollegeMember(...roles);
  const db = getAdminDb();
  const subject = await loadSubject(db, session.collegeId, subjectId);
  if (!subject) return { error: NextResponse.json({ error: "Subject not found" }, { status: 404 }) } as const;
  const role = await syllabusRoleOf(db, session, subject);
  return { session, db, subject, ...role } as const;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const c = await context(id, SYLLABUS_READ_ROLES);
    if ("error" in c) return c.error;
    const syllabus = await loadSyllabus(c.db, c.session.collegeId, id);
    const status = syllabus?.status ?? null;
    return NextResponse.json({
      subject: {
        id: c.subject.id, name: c.subject.name, code: c.subject.code, courseName: c.subject.courseName ?? "", regulation: c.subject.regulation ?? "",
        syllabusUrl: c.subject.syllabusUrl ?? null, syllabusFileName: c.subject.syllabusFileName ?? null,
      },
      subjectDepartments: c.owners,
      syllabus,
      can: {
        // Not set: Academics sets the Subject Department first (Curriculum > Subjects).
        hodEdit: c.isHod && (status === null || status === "DRAFT" || status === "RETURNED"),
        decide: c.isAcademics && status === "SUBMITTED",
        editFrozen: c.isAcademics && status === "FROZEN",
        isHod: c.isHod, isAcademics: c.isAcademics,
      },
    });
  } catch (err) {
    return guardError(err, "[subjects/[id]/syllabus-outcomes GET]");
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const c = await context(id, ["HOD", ...ACADEMICS_ROLES]);
    if ("error" in c) return c.error;
    if (c.owners.length === 0) return NextResponse.json({ error: "Academics hasn't set this subject's Subject Department yet" }, { status: 409 });
    const actor: SyllabusActor | null = c.isAcademics ? "ACADEMICS" : c.isHod ? "HOD" : null;
    if (!actor) return NextResponse.json({ error: "Only the HOD of this subject's department prepares its syllabus" }, { status: 403 });
    const body = (await readJsonBody(request)) as Record<string, unknown> & { baseVersion?: number };
    // A frozen syllabus stays complete (every CO mapped); a draft may be saved part-done.
    const current = await loadSyllabus(c.db, c.session.collegeId, id);
    const step = syllabusStep(current?.status ?? null, actor, "SAVE");
    if ("error" in step) return NextResponse.json({ error: step.error }, { status: 409 });
    const { value, errors } = cleanSyllabus(body, actor === "ACADEMICS");
    if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    if (actor === "ACADEMICS") {
      // Mid banks / papers already written on it keep every unit and CO their questions use.
      const conflicts = outcomeConflicts(value, await usedOutcomeRefs(c.db, c.session.collegeId, syllabusOutcomesId(id)));
      if (conflicts.length) return NextResponse.json({ error: conflicts[0], errors: conflicts }, { status: 409 });
    }
    const name = (await actorName(c.db, c.session.collegeId, c.session.uid)) || c.session.email;
    const ref = syllabusCol(c.db, c.session.collegeId).doc(id);
    const res = await c.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cur = snap.exists ? (snap.data() as SubjectSyllabus) : null;
      if ((cur?.version ?? 0) !== Number(body.baseVersion ?? 0)) return { conflict: true } as const;
      const again = syllabusStep(cur?.status ?? null, actor, "SAVE");
      if ("error" in again) return { refused: again.error } as const;
      const now = new Date().toISOString();
      const changes = cur && actor === "ACADEMICS" ? syllabusChanges(cur, value) : [];
      if (cur && actor === "ACADEMICS" && changes.length === 0) return { saved: cur, changes } as const;
      const entry: SyllabusHistoryEntry = actor === "ACADEMICS"
        ? { at: now, byUid: c.session.uid, byName: name, role: "ACADEMICS", action: "EDITED_AFTER_FREEZE", changes }
        : { at: now, byUid: c.session.uid, byName: name, role: "HOD", action: "SAVED" };
      // The HOD's draft saves aren't each kept - only the steps (and every change after the freeze).
      const history = actor === "ACADEMICS" ? [...(cur?.history ?? []), entry] : (cur?.history ?? []);
      const data: SubjectSyllabus = {
        subjectId: id, subjectName: c.subject.name, subjectCode: c.subject.code, courseName: c.subject.courseName ?? "", regulation: c.subject.regulation ?? "",
        ...value, status: again.status, version: (cur?.version ?? 0) + 1,
        returnRemarks: cur?.returnRemarks ?? null, submittedAt: cur?.submittedAt ?? null, submittedByName: cur?.submittedByName ?? null,
        frozenAt: cur?.frozenAt ?? null, frozenByName: cur?.frozenByName ?? null,
        updatedAt: now, updatedByUid: c.session.uid, updatedByName: name, history: history.slice(-HISTORY_MAX),
      };
      tx.set(ref, data);
      return { saved: data, changes } as const;
    });
    if ("conflict" in res) return NextResponse.json({ error: "Someone else saved this syllabus meanwhile - reload to see their version" }, { status: 409 });
    if ("refused" in res) return NextResponse.json({ error: res.refused }, { status: 409 });
    if (actor === "ACADEMICS" && res.changes.length) {
      await writeAuditLogSafe(c.db, c.session.collegeId, {
        action: "SYLLABUS_CHANGED", performedBy: c.session.uid, performedByName: name, targetId: id,
        details: { subject: `${c.subject.name} (${c.subject.code})`, changes: res.changes.map((x) => `${x.field}: ${x.before} -> ${x.after}`).slice(0, 50) },
      });
      await notifyHods(c.db, c.session.collegeId, c.owners, "SYLLABUS_CHANGED", `Syllabus changed - ${c.subject.name}`,
        `${name} (Academics) changed ${res.changes.length} item${res.changes.length === 1 ? "" : "s"} of the frozen syllabus of ${c.subject.name} (${c.subject.code}).`, id);
    }
    return NextResponse.json({ syllabus: res.saved });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[subjects/[id]/syllabus-outcomes PUT]");
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const c = await context(id, ["HOD", ...ACADEMICS_ROLES]);
    if ("error" in c) return c.error;
    const body = (await readJsonBody(request)) as { action?: string; remarks?: string; baseVersion?: number };
    const action = String(body.action ?? "") as SyllabusAction;
    if (!["SUBMIT", "FREEZE", "RETURN"].includes(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    const actor: SyllabusActor | null = action === "SUBMIT" ? (c.isHod ? "HOD" : null) : (c.isAcademics ? "ACADEMICS" : null);
    if (!actor) return NextResponse.json({ error: action === "SUBMIT" ? "Only the HOD of this subject's department submits its syllabus" : "Only Academics freezes or returns a syllabus" }, { status: 403 });
    const remarks = String(body.remarks ?? "").trim().slice(0, 1000);
    if (action === "RETURN" && !remarks) return NextResponse.json({ error: "Say what needs changing" }, { status: 400 });
    const name = (await actorName(c.db, c.session.collegeId, c.session.uid)) || c.session.email;
    const ref = syllabusCol(c.db, c.session.collegeId).doc(id);
    const res = await c.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cur = snap.exists ? (snap.data() as SubjectSyllabus) : null;
      if (!cur) return { refused: "Save the syllabus first" } as const;
      if (cur.version !== Number(body.baseVersion ?? 0)) return { conflict: true } as const;
      const step = syllabusStep(cur.status, actor, action);
      if ("error" in step) return { refused: step.error } as const;
      // Submitting / freezing needs it complete.
      if (action !== "RETURN") {
        const { errors } = cleanSyllabus(cur, true);
        if (errors.length) return { refused: errors[0] } as const;
      }
      const now = new Date().toISOString();
      const entry: SyllabusHistoryEntry = {
        at: now, byUid: c.session.uid, byName: name, role: actor,
        action: action === "SUBMIT" ? "SUBMITTED" : action === "FREEZE" ? "FROZEN" : "RETURNED", ...(remarks ? { remarks } : {}),
      };
      const next: SubjectSyllabus = {
        ...cur, status: step.status, version: cur.version + 1, updatedAt: now, updatedByUid: c.session.uid, updatedByName: name,
        ...(action === "SUBMIT" ? { submittedAt: now, submittedByName: name, returnRemarks: null } : {}),
        ...(action === "FREEZE" ? { frozenAt: now, frozenByName: name } : {}),
        ...(action === "RETURN" ? { returnRemarks: remarks } : {}),
        history: [...(cur.history ?? []), entry].slice(-HISTORY_MAX),
      };
      tx.set(ref, next);
      return { saved: next } as const;
    });
    if ("conflict" in res) return NextResponse.json({ error: "Someone else changed this syllabus meanwhile - reload" }, { status: 409 });
    if ("refused" in res) return NextResponse.json({ error: res.refused }, { status: 409 });
    await writeAuditLogSafe(c.db, c.session.collegeId, {
      action: `SYLLABUS_${action === "SUBMIT" ? "SUBMITTED" : action === "FREEZE" ? "FROZEN" : "RETURNED"}`, performedBy: c.session.uid, performedByName: name, targetId: id,
      details: { subject: `${c.subject.name} (${c.subject.code})`, ...(remarks ? { remarks } : {}) },
    });
    const what = `${c.subject.name} (${c.subject.code})`;
    if (action === "SUBMIT") await notifyAcademics(c.db, c.session.collegeId, "SYLLABUS_SUBMITTED", `Syllabus to freeze - ${c.subject.name}`, `${name} submitted the syllabus of ${what} for freezing.`, id);
    if (action === "FREEZE") await notifyHods(c.db, c.session.collegeId, c.owners, "SYLLABUS_FROZEN", `Syllabus frozen - ${c.subject.name}`, `Academics froze the syllabus of ${what}. Faculty can now prepare its Mid papers.`, id);
    if (action === "RETURN") await notifyHods(c.db, c.session.collegeId, c.owners, "SYLLABUS_RETURNED", `Syllabus returned - ${c.subject.name}`, `Academics returned the syllabus of ${what}: ${remarks}`, id);
    return NextResponse.json({ syllabus: res.saved });
  } catch (err) {
    const bad = badBodyResponse(err);
    if (bad) return bad;
    return guardError(err, "[subjects/[id]/syllabus-outcomes POST]");
  }
}
