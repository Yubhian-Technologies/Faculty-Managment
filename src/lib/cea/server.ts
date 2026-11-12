import { NextResponse } from "next/server";
import { badBodyResponse } from "@/lib/http/readJsonBody";
import { courseKeyForSubject } from "@/lib/midBank/server";
import { isMidBankSubject } from "@/lib/midBank/sections";
import { loadSyllabus, syllabusRoleOf } from "@/lib/subjects/syllabusServer";
import type { CeaPlan, CeaSettings, PaperPartDef, Subject } from "@/types";
import { ceaPart } from "./paper";
import { CeaRuleError, midOf } from "./rules";

// Server side of CEA: where it lives, which subjects it covers and who may plan them.
// Settings: Exam Cell (per course + regulation). Plan: the HOD of the subject's Subject Department (as for the
// syllabus), or the Exam Cell. Everyone who reads a syllabus reads the plan.

type Db = FirebaseFirestore.Firestore;

export const ceaRefs = (db: Db, collegeId: string) => {
  const college = db.collection("colleges").doc(collegeId);
  return { college, settings: college.collection("ceaSettings"), plans: college.collection("ceaPlans"), subjects: college.collection("subjects") };
};

export const CEA_SETTINGS_ROLES = ["EXAM_CELL", "SUPER_ADMIN"];
export const CEA_READ_ROLES = ["HOD", "PANEL_MEMBER", "EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", "ACADEMICS", "SUPER_ADMIN"];

export class CeaError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 = 400) { super(message); }
}

export async function loadAllCeaSettings(db: Db, collegeId: string): Promise<CeaSettings[]> {
  return (await ceaRefs(db, collegeId).settings.get()).docs.map((d) => ({ ...(d.data() as CeaSettings), id: d.id }));
}

/** The CEA settings a subject falls under (its course + its own regulation, switched on), or null. */
export function settingsFor(all: CeaSettings[], courseKey: string, regulation: string | undefined): CeaSettings | null {
  const reg = (regulation ?? "").trim().toUpperCase();
  return all.find((s) => s.enabled && s.courseKey === courseKey && s.regulation === reg) ?? null;
}

/** Subjects that need a CEA plan: Mid-exam subjects (theory, in the teaching load) under switched-on settings. */
export async function ceaSubjects(db: Db, collegeId: string, all?: CeaSettings[]): Promise<{ subject: Subject; settings: CeaSettings; courseKey: string }[]> {
  const settings = all ?? (await loadAllCeaSettings(db, collegeId));
  if (!settings.some((s) => s.enabled)) return [];
  const snap = await ceaRefs(db, collegeId).subjects.get();
  const out: { subject: Subject; settings: CeaSettings; courseKey: string }[] = [];
  const keyCache = new Map<string, string>();
  for (const d of snap.docs) {
    const subject = { ...(d.data() as Subject), id: d.id };
    if (subject.isActive === false || !isMidBankSubject(subject)) continue;
    const reg = (subject.regulation ?? "").trim().toUpperCase();
    if (!settings.some((s) => s.enabled && s.regulation === reg)) continue;
    const cacheKey = `${subject.catalogId ?? ""}|${subject.courseId ?? ""}|${subject.courseName ?? ""}`;
    const courseKey = keyCache.get(cacheKey) ?? (await courseKeyForSubject(db, collegeId, subject));
    keyCache.set(cacheKey, courseKey);
    const s = settingsFor(settings, courseKey, subject.regulation);
    if (s) out.push({ subject, settings: s, courseKey });
  }
  return out;
}

/** The subject, its CEA settings, frozen syllabus units, plan, and what the caller may do. */
export async function ceaContext(db: Db, session: { uid: string; role: string; collegeId: string }, subjectId: string) {
  const snap = await ceaRefs(db, session.collegeId).subjects.doc(subjectId).get();
  if (!snap.exists) throw new CeaError("Subject not found", 404);
  const subject = { ...(snap.data() as Subject), id: snap.id };
  const courseKey = await courseKeyForSubject(db, session.collegeId, subject);
  const [all, syllabus, planSnap, role] = await Promise.all([
    loadAllCeaSettings(db, session.collegeId), loadSyllabus(db, session.collegeId, subjectId),
    ceaRefs(db, session.collegeId).plans.doc(subjectId).get(), syllabusRoleOf(db, session, subject),
  ]);
  const settings = settingsFor(all, courseKey, subject.regulation);
  const units = syllabus?.status === "FROZEN" ? syllabus.units.map((u) => ({ unit: u.no, title: u.title })) : [];
  const canEdit = role.isHod || CEA_SETTINGS_ROLES.includes(session.role);
  return { subject, courseKey, settings, syllabusStatus: syllabus?.status ?? null, units, plan: planSnap.exists ? (planSnap.data() as CeaPlan) : null, canEdit, owners: role.owners };
}

export function ceaErrorResponse(err: unknown, label: string): NextResponse {
  const bad = badBodyResponse(err);
  if (bad) return bad;
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (err instanceof CeaError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof CeaRuleError) return NextResponse.json({ error: err.message }, { status: 400 });
  console.error(label, err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}

// ─── The CEA paper inside a Mid paper set ───────────────────────────────────────


/**
 * A subject's CEA paper for Mid n: the part to add to the setter's paper set (null when the subject has no CEA,
 * or no unit planned with that Mid), or an issue when CEA is on but the Subject Department hasn't planned yet.
 */
export async function ceaPartForMid(db: Db, collegeId: string, subject: Subject, midNumber: number): Promise<{ part: PaperPartDef | null; issue?: string }> {
  const all = await loadAllCeaSettings(db, collegeId);
  if (!all.some((s) => s.enabled)) return { part: null };
  const courseKey = await courseKeyForSubject(db, collegeId, subject);
  const settings = settingsFor(all, courseKey, subject.regulation);
  if (!settings || !isMidBankSubject(subject)) return { part: null };
  const plan = (await ceaRefs(db, collegeId).plans.doc(subject.id).get()).data() as CeaPlan | undefined;
  if (!plan) return { part: null, issue: `The Subject Department hasn't made the CIE plan for ${subject.code} yet (HOD > CIE) - it says which unit's CIE paper goes with this Mid.` };
  const unit = plan.units.find((u) => midOf(u.when) === midNumber);
  return { part: unit ? ceaPart({ unitMarks: settings.unitMarks, paperMinutes: settings.paperMinutes }, unit.unit) : null };
}

/** Mids whose paper the Exam Cell already printed (finalized) for this subject - their CEA unit can't change any more. */
export async function printedMids(db: Db, collegeId: string, subjectId: string): Promise<Set<number>> {
  const college = ceaRefs(db, collegeId).college;
  const choices = (await college.collection("midPaperChoices").where("subjectId", "==", subjectId).get()).docs
    .map((d) => d.data() as { planId?: string; final?: unknown }).filter((c) => c.final && c.planId);
  const out = new Set<number>();
  for (const planId of new Set(choices.map((c) => c.planId!))) {
    const p = await college.collection("midExamPlans").doc(planId).get();
    const n = Number(p.get("midNumber"));
    if (n) out.add(n);
  }
  return out;
}
