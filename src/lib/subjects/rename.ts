import { FieldPath, type DocumentSnapshot, type Firestore, type Query } from "firebase-admin/firestore";
import { ChunkedBatch } from "@/lib/firestore/chunkedBatch";

// Renaming a subject that is already in use (new Code and / or Name): every record that keeps its own copy of the
// subject's name / code is brought to the new one - curriculum, teaching, timetable, attendance (past included),
// exams, published results, mentoring records. Run as a JOB in small steps (a subject can have thousands of
// attendance records), resumable: colleges/{c}/subjectRenameJobs/{id} keeps each step's cursor.
//
// Deliberately NOT rewritten: issued certificates and finalized (printed) question papers - frozen documents - and
// audit logs. The master subject itself is renamed (with its code lock) before the job starts.

type Db = Firestore;
export interface RenameTarget { name: string; code: string }
export interface RenameCtx { db: Db; collegeId: string; subjectId: string; to: RenameTarget; groupCourseIds: string[] }
export interface StepResult { updated: number; scanned: number; cursor: string | null }

const PAGE = 300;
const college = (db: Db, c: string) => db.collection("colleges").doc(c);
const after = (q: Query, cursor: string | null) => (cursor ? q.startAfter(cursor) : q);

/** The fields of a record holding the subject's copy, replaced only where they exist (nothing is added). */
function patchFields(data: Record<string, unknown>, to: RenameTarget, nameKey = "subjectName", codeKey = "subjectCode"): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (nameKey in data && data[nameKey] !== to.name) out[nameKey] = to.name;
  if (codeKey in data && data[codeKey] !== to.code) out[codeKey] = to.code;
  return Object.keys(out).length ? out : null;
}

/** An array of items (timetable slots, result subjects ...): the items of this subject, renamed. null = no change. */
export function patchItems<T extends Record<string, unknown>>(items: unknown, idKey: string, subjectId: string, to: RenameTarget, nameKey: string, codeKey: string): T[] | null {
  if (!Array.isArray(items)) return null;
  let changed = false;
  const next = items.map((it) => {
    if (!it || typeof it !== "object" || (it as Record<string, unknown>)[idKey] !== subjectId) return it;
    const p = patchFields(it as Record<string, unknown>, to, nameKey, codeKey);
    if (!p) return it;
    changed = true;
    return { ...(it as object), ...p };
  });
  return changed ? (next as T[]) : null;
}

async function flatStep(ctx: RenameCtx, col: string, cursor: string | null): Promise<StepResult> {
  const q = after(college(ctx.db, ctx.collegeId).collection(col).where("subjectId", "==", ctx.subjectId).orderBy(FieldPath.documentId()), cursor).limit(PAGE);
  const snap = await q.get();
  const batch = new ChunkedBatch(ctx.db);
  let updated = 0;
  for (const d of snap.docs) {
    const p = patchFields(d.data(), ctx.to);
    if (p) { batch.update(d.ref, p); updated++; }
  }
  await batch.commit();
  return { updated, scanned: snap.size, cursor: snap.size < PAGE ? null : snap.docs[snap.docs.length - 1].id };
}

/** Every doc of a (small) collection, renaming the items of one array field. */
async function arrayScanStep(ctx: RenameCtx, col: string, field: string, idKey: string, nameKey: string, codeKey: string, cursor: string | null, base?: Query): Promise<StepResult> {
  const q = after((base ?? college(ctx.db, ctx.collegeId).collection(col)).orderBy(FieldPath.documentId()), cursor).limit(PAGE);
  const snap = await q.get();
  const batch = new ChunkedBatch(ctx.db);
  let updated = 0;
  for (const d of snap.docs) {
    const next = patchItems(d.get(field), idKey, ctx.subjectId, ctx.to, nameKey, codeKey);
    if (next) { batch.update(d.ref, { [field]: next }); updated++; }
  }
  await batch.commit();
  return { updated, scanned: snap.size, cursor: snap.size < PAGE ? null : snap.docs[snap.docs.length - 1].id };
}

/** Published / draft results: the result sheets of the subject's course, then each sheet's student records. */
async function resultsStep(ctx: RenameCtx, cursor: string | null): Promise<StepResult> {
  const c = college(ctx.db, ctx.collegeId);
  const ids = ctx.groupCourseIds.slice(0, 30);
  if (ids.length === 0) return { updated: 0, scanned: 0, cursor: null };
  const batches = (await c.collection("semesterResultBatches").where("courseIds", "array-contains-any", ids).get()).docs.map((d) => d.id).sort();
  // cursor = "<sheet index>|<last record id in that sheet>"
  const [bs, ds] = (cursor ?? "0|").split("|");
  let bi = Number(bs) || 0;
  let dc: string | null = ds || null;
  let updated = 0, scanned = 0;
  while (bi < batches.length) {
    const r = await arrayScanStep(ctx, "semesterResults", "subjects", "subjectId", "subjectName", "subjectCode", dc,
      c.collection("semesterResults").where("batchId", "==", batches[bi]));
    updated += r.updated; scanned += r.scanned;
    if (r.cursor) return { updated, scanned, cursor: `${bi}|${r.cursor}` };
    bi += 1; dc = null;
    if (scanned >= PAGE) return { updated, scanned, cursor: bi < batches.length ? `${bi}|` : null };
  }
  return { updated, scanned, cursor: null };
}

/** Mentoring records: each student of the subject's course keeps per-semester subject copies. */
async function mentoringStep(ctx: RenameCtx, cursor: string | null): Promise<StepResult> {
  const c = college(ctx.db, ctx.collegeId);
  const ids = ctx.groupCourseIds.slice(0, 30);
  if (ids.length === 0) return { updated: 0, scanned: 0, cursor: null };
  const students = await after(c.collection("students").where("courseId", "in", ids).orderBy(FieldPath.documentId()), cursor).limit(60).get();
  const batch = new ChunkedBatch(ctx.db);
  let updated = 0;
  const sems = await Promise.all(students.docs.map((s) => s.ref.collection("mentoringSemesters").get()));
  for (const snap of sems) for (const d of snap.docs) {
    const next = patchItems(d.get("subjects"), "subjectId", ctx.subjectId, ctx.to, "name", "code");
    if (next) { batch.update(d.ref, { subjects: next }); updated++; }
  }
  await batch.commit();
  return { updated, scanned: students.size, cursor: students.size < 60 ? null : students.docs[students.docs.length - 1].id };
}

async function singleDocStep(ctx: RenameCtx, col: string): Promise<StepResult> {
  const ref = college(ctx.db, ctx.collegeId).collection(col).doc(ctx.subjectId);
  const d: DocumentSnapshot = await ref.get();
  const p = d.exists ? patchFields(d.data() ?? {}, ctx.to) : null;
  if (p) await ref.update(p);
  return { updated: p ? 1 : 0, scanned: d.exists ? 1 : 0, cursor: null };
}

export interface RenameStep {
  key: string;
  label: string;
  /** Records it would touch (preview); undefined = found while running. */
  count?: (ctx: RenameCtx) => Promise<number>;
  run: (ctx: RenameCtx, cursor: string | null) => Promise<StepResult>;
}

const flat = (key: string, col: string, label: string): RenameStep => ({
  key, label,
  count: async (ctx) => (await college(ctx.db, ctx.collegeId).collection(col).where("subjectId", "==", ctx.subjectId).count().get()).data().count,
  run: (ctx, cursor) => flatStep(ctx, col, cursor),
});

/** In order: what people use day to day first, then history. */
export const RENAME_STEPS: RenameStep[] = [
  flat("semesterAssignments", "subjectSemesterAssignments", "Semester assignments"),
  flat("teaching", "teachingAssignments", "Teaching assignments"),
  flat("timetable", "timetableSlots", "Timetable periods"),
  { key: "timetableDrafts", label: "Timetable drafts", run: (ctx, c) => arrayScanStep(ctx, "timetableDrafts", "slots", "subjectId", "subjectName", "subjectCode", c) },
  flat("assignmentRequests", "facultyAssignmentRequests", "Faculty assignment requests"),
  flat("labAllocations", "labAttendanceAllocations", "Lab attendance allocations"),
  flat("attendance", "studentAttendance", "Class attendance records"),
  flat("marks", "internalExamMarks", "Internal marks"),
  {
    key: "marksCategories", label: "Marks categories",
    count: async (ctx) => (await college(ctx.db, ctx.collegeId).collection("examMarksCategories").where("subjectIds", "array-contains", ctx.subjectId).count().get()).data().count,
    run: (ctx, c) => arrayScanStep(ctx, "examMarksCategories", "subjects", "id", "name", "code", c,
      college(ctx.db, ctx.collegeId).collection("examMarksCategories").where("subjectIds", "array-contains", ctx.subjectId)),
  },
  flat("paperSetters", "midPaperAssignments", "Mid paper setters"),
  flat("outcomes", "subjectOutcomes", "Course outcomes (COs)"),
  flat("bankAssignments", "midBankAssignments", "Question bank assignments"),
  flat("banks", "midQuestionBanks", "Question banks / papers"),
  { key: "splits", label: "Mid unit splits", run: (ctx) => singleDocStep(ctx, "midBankSubjectSplits") },
  { key: "midTimetables", label: "Mid timetables", run: (ctx, c) => arrayScanStep(ctx, "midTimetables", "slots", "subjectId", "subjectName", "subjectCode", c) },
  { key: "facultyModules", label: "Faculty modules", run: (ctx, c) => arrayScanStep(ctx, "facultyAssignedModules", "modules", "subjectId", "subjectName", "subjectCode", c) },
  { key: "results", label: "Semester results", run: (ctx, c) => resultsStep(ctx, c) },
  { key: "mentoring", label: "Mentoring records", run: (ctx, c) => mentoringStep(ctx, c) },
];

export interface RenameJob {
  id: string;
  subjectId: string;
  from: RenameTarget;
  to: RenameTarget;
  groupCourseIds: string[];
  status: "RUNNING" | "DONE";
  /** The step being worked on (index into RENAME_STEPS) and where it stopped. */
  stepIndex: number;
  cursor: string | null;
  updated: Record<string, number>;
  startedByUid: string;
  startedByName: string;
  startedAt: string;
  finishedAt?: string;
}

export const renameJobsCol = (db: Db, c: string) => college(db, c).collection("subjectRenameJobs");

/** Works on a job for up to `budgetMs`, saving where it stopped. Repeat until DONE (each call is safe to repeat). */
export async function runRenameJob(db: Db, collegeId: string, jobId: string, budgetMs = 20_000): Promise<RenameJob> {
  const ref = renameJobsCol(db, collegeId).doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("RENAME_JOB_NOT_FOUND");
  const job = { ...(snap.data() as Omit<RenameJob, "id">), id: snap.id } as RenameJob;
  if (job.status === "DONE") return job;
  const ctx: RenameCtx = { db, collegeId, subjectId: job.subjectId, to: job.to, groupCourseIds: job.groupCourseIds };
  const started = Date.now();
  // At least one step per call (so every call moves it on), then more while time is left.
  for (let first = true; job.stepIndex < RENAME_STEPS.length && (first || Date.now() - started < budgetMs); first = false) {
    const step = RENAME_STEPS[job.stepIndex];
    const r = await step.run(ctx, job.cursor);
    job.updated = { ...job.updated, [step.key]: (job.updated[step.key] ?? 0) + r.updated };
    if (r.cursor) job.cursor = r.cursor;
    else { job.stepIndex += 1; job.cursor = null; }
    await ref.update({ stepIndex: job.stepIndex, cursor: job.cursor, updated: job.updated });
  }
  if (job.stepIndex >= RENAME_STEPS.length) {
    job.status = "DONE";
    job.finishedAt = new Date().toISOString();
    await ref.update({ status: "DONE", finishedAt: job.finishedAt });
  }
  return job;
}

export const renameProgress = (job: Pick<RenameJob, "stepIndex" | "status">) => ({
  step: job.status === "DONE" ? "Done" : RENAME_STEPS[job.stepIndex]?.label ?? "Done",
  done: job.status === "DONE" ? RENAME_STEPS.length : job.stepIndex,
  total: RENAME_STEPS.length,
});
