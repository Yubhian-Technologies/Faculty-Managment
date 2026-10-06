import { FieldPath, FieldValue } from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { isOnDutyMark } from "./counting";

// Per-student, per-day attendance tally - what the student dashboard reads
// instead of scanning the whole department's sessions (see
// STUDENT_DASHBOARD_IMPLEMENTATION_PLAN.md).
//
//   colleges/{c}/studentAttendanceTally/{studentId}_{YYYY-MM}
//     { studentId, month,
//       sections: { [sectionKey]: { [YYYY-MM-DD]: { [subjectId]: { h, a } } } },
//       names:    { [subjectId]: { name, code } } }
//
// Kept exact INSIDE the transaction that changes a session's counted result
// (faculty submit, office correction, on-duty apply/release): the delta between
// the session as it was and as it becomes is added with FieldValue.increment,
// so the dashboard is current the moment attendance is posted. `rebuildDay`
// recomputes a whole day from the sessions (backfill / reconcile) and overwrites
// rather than adds, so it also repairs any drift.
//
// Counting rule is exactly counting.ts: only SUBMITTED sessions, only students on
// the session's roster, ON_DUTY counts as neither held nor attended.

export type TallyMode = "off" | "shadow" | "on";

/** ATTENDANCE_TALLY = off (default) | shadow (write + compare, serve live) | on (serve the tally). */
export function tallyMode(): TallyMode {
  const v = process.env.ATTENDANCE_TALLY;
  return v === "shadow" || v === "on" ? v : "off";
}

/** Whether session writes must keep the tally current. */
export const tallyWritesEnabled = (): boolean => tallyMode() !== "off";

export interface TallySession {
  status?: string;
  date: string;
  sectionId?: string;
  sectionName?: string;
  year?: number;
  subjectId: string;
  subjectName?: string;
  subjectCode?: string;
  entries: { studentId: string; status: string | null }[];
}

type Pair = [held: number, attended: number];

const COLLECTION = "studentAttendanceTally";
const MAX_MONTHS = 48;

const tallyCol = (db: Firestore, collegeId: string) => db.collection("colleges").doc(collegeId).collection(COLLECTION);

export const tallyDocId = (studentId: string, date: string) => `${studentId}_${date.slice(0, 7)}`;

/** Sections are keyed by id; a legacy session without one by name + year. */
export const tallySectionKey = (s: Pick<TallySession, "sectionId" | "sectionName" | "year">) =>
  s.sectionId || `n_${s.sectionName ?? ""}_${s.year ?? 0}`;

/** studentId -> [held, attended] one session contributes. */
export function sessionContribution(s: TallySession | null | undefined): Map<string, Pair> {
  const out = new Map<string, Pair>();
  if (!s || s.status !== "SUBMITTED") return out;
  for (const e of s.entries) {
    if (isOnDutyMark(e.status)) { out.delete(e.studentId); continue; }
    out.set(e.studentId, [1, e.status === "PRESENT" ? 1 : 0]);
  }
  return out;
}

/** What changes in each student's tally when a session goes from `before` to `after` (zero deltas omitted). */
export function sessionTallyDelta(before: TallySession | null | undefined, after: TallySession | null | undefined): Map<string, Pair> {
  const b = sessionContribution(before);
  const a = sessionContribution(after);
  const out = new Map<string, Pair>();
  for (const id of new Set([...b.keys(), ...a.keys()])) {
    const [bh, ba] = b.get(id) ?? [0, 0];
    const [ah, aa] = a.get(id) ?? [0, 0];
    if (ah !== bh || aa !== ba) out.set(id, [ah - bh, aa - ba]);
  }
  return out;
}

/**
 * Adds the delta of one session change to the students' tally docs, inside the
 * caller's transaction. Write-only (no reads), so it can run after the
 * transaction's own reads. Does nothing when the counted result is unchanged.
 */
export function applyTallyDeltaInTx(
  tx: Transaction, db: Firestore, collegeId: string,
  before: TallySession | null | undefined, after: TallySession
): void {
  if (!tallyWritesEnabled()) return;
  const delta = sessionTallyDelta(before, after);
  if (delta.size === 0) return;
  const section = tallySectionKey(after);
  for (const [studentId, [dh, da]] of delta) {
    tx.set(tallyCol(db, collegeId).doc(tallyDocId(studentId, after.date)), {
      studentId,
      month: after.date.slice(0, 7),
      sections: { [section]: { [after.date]: { [after.subjectId]: { h: FieldValue.increment(dh), a: FieldValue.increment(da) } } } },
      names: { [after.subjectId]: { name: after.subjectName ?? "", code: after.subjectCode ?? "" } },
    }, { merge: true });
  }
}

/**
 * Recomputes one calendar day from its SUBMITTED sessions and OVERWRITES that
 * day's section entries for every student on a roster that day. Idempotent -
 * used by the backfill and the reconcile job. Returns the number of tally docs written.
 */
export async function rebuildDay(db: Firestore, collegeId: string, date: string): Promise<number> {
  const snap = await db.collection("colleges").doc(collegeId).collection("studentAttendance")
    .where("date", "==", date).where("status", "==", "SUBMITTED").get();

  type Cell = { h: number; a: number };
  // `${studentId}|${sectionKey}` -> subjectId -> counts
  const cells = new Map<string, { studentId: string; section: string; subjects: Map<string, Cell> }>();
  const names = new Map<string, { name: string; code: string }>();
  for (const d of snap.docs) {
    const s = d.data() as TallySession;
    const section = tallySectionKey(s);
    names.set(s.subjectId, { name: s.subjectName ?? "", code: s.subjectCode ?? "" });
    for (const [studentId, [h, a]] of sessionContribution(s)) {
      const key = `${studentId}|${section}`;
      const entry = cells.get(key) ?? { studentId, section, subjects: new Map<string, Cell>() };
      const cur = entry.subjects.get(s.subjectId) ?? { h: 0, a: 0 };
      cur.h += h;
      cur.a += a;
      entry.subjects.set(s.subjectId, cur);
      cells.set(key, entry);
    }
  }

  let written = 0;
  let batch = db.batch();
  let inBatch = 0;
  for (const { studentId, section, subjects } of cells.values()) {
    const bySubject: Record<string, Cell> = {};
    const nameFields: Record<string, { name: string; code: string }> = {};
    const mergeFields: (string | FieldPath)[] = [new FieldPath("sections", section, date), "studentId", "month"];
    for (const [subjectId, c] of subjects) {
      bySubject[subjectId] = c;
      nameFields[subjectId] = names.get(subjectId) ?? { name: "", code: "" };
      mergeFields.push(new FieldPath("names", subjectId));
    }
    batch.set(tallyCol(db, collegeId).doc(tallyDocId(studentId, date)), {
      studentId, month: date.slice(0, 7), sections: { [section]: { [date]: bySubject } }, names: nameFields,
    }, { mergeFields });
    written += 1;
    if (++inBatch >= 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
  }
  if (inBatch > 0) await batch.commit();
  return written;
}

export interface TallyRow { subjectId: string; subjectName: string; subjectCode: string; held: number; attended: number }

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < MAX_MONTHS) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** A student's per-subject totals for [from, to] (inclusive dates) from their month docs: one batched read. */
export async function readStudentTally(
  db: Firestore, collegeId: string, studentId: string, from: string, to: string
): Promise<TallyRow[]> {
  const refs = monthsBetween(from, to).map((ym) => tallyCol(db, collegeId).doc(`${studentId}_${ym}`));
  if (refs.length === 0) return [];
  const snaps = await db.getAll(...refs);
  const totals = new Map<string, TallyRow>();
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const doc = snap.data() as {
      sections?: Record<string, Record<string, Record<string, { h?: number; a?: number }>>>;
      names?: Record<string, { name?: string; code?: string }>;
    };
    for (const days of Object.values(doc.sections ?? {})) {
      for (const [date, subjects] of Object.entries(days)) {
        if (date < from || date > to) continue;
        for (const [subjectId, v] of Object.entries(subjects)) {
          const row = totals.get(subjectId) ?? {
            subjectId, subjectName: doc.names?.[subjectId]?.name ?? "", subjectCode: doc.names?.[subjectId]?.code ?? "", held: 0, attended: 0,
          };
          row.held += v.h ?? 0;
          row.attended += v.a ?? 0;
          totals.set(subjectId, row);
        }
      }
    }
  }
  return Array.from(totals.values()).filter((r) => r.held > 0);
}

// ── readiness: the tally is only trusted for ranges at/after the backfilled date ──

const READY_TTL_MS = 5 * 60 * 1000;
const readyCache = new Map<string, { at: number; value: string | null }>();

export async function tallyReadyFrom(db: Firestore, collegeId: string): Promise<string | null> {
  const hit = readyCache.get(collegeId);
  if (hit && Date.now() - hit.at < READY_TTL_MS) return hit.value;
  const snap = await db.collection("colleges").doc(collegeId).collection("settings").doc("attendanceTally").get();
  const value = (snap.data() as { readyFrom?: string } | undefined)?.readyFrom ?? null;
  readyCache.set(collegeId, { at: Date.now(), value });
  return value;
}

export async function setTallyReadyFrom(db: Firestore, collegeId: string, date: string): Promise<void> {
  await db.collection("colleges").doc(collegeId).collection("settings").doc("attendanceTally").set({ readyFrom: date }, { merge: true });
  readyCache.delete(collegeId);
}
