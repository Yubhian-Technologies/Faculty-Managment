import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { leavePartOn, type LeaveSpan } from "@/lib/leave/leaveDayParts";
import type { ClassAdjustment, ClassAdjustmentKind, ClassAdjustmentLeg, FacultyMember, TeachingAssignment } from "@/types";
import { getFacultyPeriodsForDate, type FacultyPeriodOnDate } from "@/lib/timetable/currentPeriod";
import { getNoClassReason } from "@/lib/studentAttendance/classDay";
import { getActiveSubstitutionsForDates } from "@/lib/leave/periodCoverage";
import { resolveLoginUidForFacultyMember } from "@/lib/faculty/resolveFacultyMemberId";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { istDateKey } from "@/lib/attendance/istTime";
import { getDepartmentHeadUids, notify } from "@/lib/notify";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { invalidateClassAdjustmentCache } from "./inForce";
import { clashWith, dateProblem, MAX_REASON, periodLabel, slotLockId } from "./rules";
import { dmy } from "@/lib/utils";

// "Adjust / Swap a Class" - server side (types/classAdjustment.ts). The colleague who takes a period teaches their
// OWN subject in it, so they must hold a current teaching assignment on that section. Every check is re-run on
// create and on accept; a period sits in at most one open adjustment (lock docs, claimed in the create transaction).

export class AdjustmentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const PAGE_LINK = "/leave/adjustments";
const col = (db: Firestore, c: string) => db.collection("colleges").doc(c);
const LOCKS = "classAdjustmentLocks";

export function todayIST(): string {
  return istDateKey(new Date());
}

interface Faculty { id: string; name: string; userUid?: string; department?: string }

async function loadFaculty(db: Firestore, c: string, ids: string[]): Promise<Map<string, Faculty>> {
  const uniq = [...new Set(ids)].filter(Boolean);
  const out = new Map<string, Faculty>();
  if (!uniq.length) return out;
  const snaps = await db.getAll(...uniq.map((id) => col(db, c).collection("facultyMembers").doc(id)));
  for (const s of snaps) {
    if (!s.exists) continue;
    const f = s.data() as FacultyMember;
    out.set(s.id, { id: s.id, name: facultyDisplayName(f), userUid: f.userUid, department: f.department });
  }
  return out;
}

/** Approved leave of a login on the date, as clock ranges (half days block their half). */
async function leaveRanges(db: Firestore, c: string, uid: string | undefined, date: string) {
  if (!uid) return [];
  const snap = await col(db, c).collection("leaveRequests").where("uid", "==", uid).where("status", "==", "APPROVED").get();
  const out: { slotId: string; startTime: string; endTime: string; label: string }[] = [];
  for (const d of snap.docs) {
    if ((d.data() as { isLateAttendancePenalty?: boolean }).isLateAttendancePenalty) continue; // the late check-in CL deduction: not a day away
    // The part of `date` the leave takes (a half day, or a range's half-day end - lib/leave/leaveDayParts.ts).
    const part = leavePartOn(d.data() as LeaveSpan, date);
    if (!part) continue;
    const range = part === "FN" ? { startTime: "00:00", endTime: "13:00" } : part === "AN" ? { startTime: "13:00", endTime: "23:59" } : { startTime: "00:00", endTime: "23:59" };
    out.push({ slotId: `leave_${d.id}`, ...range, label: "on approved leave" });
  }
  return out;
}

interface Busy { slotId: string; startTime: string; endTime: string; label: string }

/** What keeps a person from teaching at a time that day: their periods (after adjustments) and approved leave. */
async function busyOf(db: Firestore, c: string, f: Faculty, date: string): Promise<{ periods: FacultyPeriodOnDate[]; busy: Busy[] }> {
  const [periods, leave] = await Promise.all([getFacultyPeriodsForDate(db, c, f.id, date), leaveRanges(db, c, f.userUid, date)]);
  const busy: Busy[] = [
    ...periods.map((p) => ({ slotId: p.adjustedFrom ? `adj_${p.slot.id}` : p.slot.id, startTime: p.startTime, endTime: p.endTime, label: `teaching ${p.slot.subjectName} in ${periodLabel({ periodNumber: p.slot.periodNumber, startTime: p.startTime, endTime: p.endTime })}` })),
    ...leave,
  ];
  return { periods, busy };
}

function busyMessage(name: string, clash: Busy | null): string | null {
  return clash ? `${name} is ${clash.label}.` : null;
}

async function currentAssignmentsBySection(db: Firestore, c: string, sectionIds: string[]) {
  const out = new Map<string, (TeachingAssignment & { id: string })[]>();
  const ids = [...new Set(sectionIds)];
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await col(db, c).collection("teachingAssignments").where("sectionId", "in", ids.slice(i, i + 30)).get();
    for (const d of snap.docs) {
      const a = { ...(d.data() as TeachingAssignment), id: d.id };
      if (a.isPast || !a.sectionId || !a.facultyId) continue;
      out.set(a.sectionId, [...(out.get(a.sectionId) ?? []), a]);
    }
  }
  return out;
}

async function openLockedSlots(db: Firestore, c: string, date: string): Promise<Set<string>> {
  const snap = await col(db, c).collection(LOCKS).where("date", "==", date).get();
  return new Set(snap.docs.map((d) => d.id));
}

/** Slots on the date someone else is covering through an approved leave substitution. */
async function substitutedSlotIds(db: Firestore, c: string, date: string): Promise<Set<string>> {
  const subs = await getActiveSubstitutionsForDates(db, c, [date], { fresh: true });
  return new Set(subs.filter((s) => s.date === date).map((s) => s.timetableSlotId));
}

async function sessionExists(db: Firestore, c: string, assignmentId: string, date: string, period: number): Promise<boolean> {
  return (await col(db, c).collection("studentAttendance").doc(`${assignmentId}_${date}_${period}`).get()).exists;
}

// ---------------------------------------------------------------------------------------------------------------
// Options: the requester's periods that day, and for each the colleagues who teach that section (free or not),
// with - for a swap - the colleague's periods that day in sections the requester teaches.

export interface SwapOption {
  slotId: string; periodNumber: number; startTime: string; endTime: string;
  sectionId: string; sectionName: string; subjectName: string;
  myAssignments: { id: string; subjectName: string }[];
  blocked: string | null;
}
export interface CandidateOption {
  facultyId: string; name: string; department: string;
  assignments: { id: string; subjectName: string }[];
  busy: string | null;
  swaps: SwapOption[];
}
export interface PeriodOption {
  slotId: string; periodNumber: number; startTime: string; endTime: string;
  sectionId: string; sectionName: string; department: string; subjectName: string; assignmentId: string;
  blocked: string | null;
  candidates: CandidateOption[];
}

function giveable(p: FacultyPeriodOnDate, facultyId: string): boolean {
  return !p.adjustedFrom && !p.unavailableReason && p.slot.facultyId === facultyId && !!p.slot.sectionId && !p.slot.labBatch;
}

export async function buildOptions(db: Firestore, c: string, requesterId: string, date: string): Promise<{ requester: Faculty; periods: PeriodOption[]; noClassReason?: string }> {
  const problem = dateProblem(date, todayIST());
  if (problem) throw new AdjustmentError(problem);
  const requester = (await loadFaculty(db, c, [requesterId])).get(requesterId);
  if (!requester) throw new AdjustmentError("Faculty record not found. It may have been deleted.", 404);
  const noClass = await getNoClassReason(db, c, date);
  if (noClass) return { requester, periods: [], noClassReason: noClass };

  const [{ periods: myPeriods, busy: myBusy }, locked, substituted] = await Promise.all([
    busyOf(db, c, requester, date), openLockedSlots(db, c, date), substitutedSlotIds(db, c, date),
  ]);
  const mine = myPeriods.filter((p) => giveable(p, requesterId));
  if (!mine.length) return { requester, periods: [] };

  // Colleagues teaching each of my sections, and my own assignments per section (for swaps).
  const myAssignSnap = await col(db, c).collection("teachingAssignments").where("facultyId", "==", requesterId).get();
  const myBySection = new Map<string, { id: string; subjectName: string }[]>();
  for (const d of myAssignSnap.docs) {
    const a = d.data() as TeachingAssignment;
    if (a.isPast || !a.sectionId) continue;
    myBySection.set(a.sectionId, [...(myBySection.get(a.sectionId) ?? []), { id: d.id, subjectName: a.subjectName }]);
  }
  const bySection = await currentAssignmentsBySection(db, c, mine.map((p) => p.slot.sectionId));
  const candidateIds = new Set<string>();
  for (const list of bySection.values()) for (const a of list) if (a.facultyId !== requesterId) candidateIds.add(a.facultyId);
  const people = await loadFaculty(db, c, [...candidateIds]);
  const days = new Map(await Promise.all([...people.values()].map(async (f) => [f.id, await busyOf(db, c, f, date)] as const)));

  const today = todayIST();
  const nowHHMM = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());

  const out: PeriodOption[] = [];
  for (const p of mine) {
    const sectionName = bySection.get(p.slot.sectionId)?.find((a) => a.id === p.slot.assignmentId)?.sectionName
      ?? myAssignSnap.docs.find((d) => d.id === p.slot.assignmentId)?.get("sectionName") ?? "";
    const lockId = slotLockId(date, { sectionId: p.slot.sectionId, day: p.slot.day, periodNumber: p.slot.periodNumber, fromFacultyId: requesterId });
    let blocked: string | null = null;
    if (date === today && p.startTime && p.startTime <= nowHHMM) blocked = "This period has already started.";
    else if (locked.has(lockId)) blocked = "This period is already in an adjustment.";
    else if (substituted.has(p.slot.id)) blocked = "A substitute is already covering this period.";
    else if (await sessionExists(db, c, p.slot.assignmentId, date, p.slot.periodNumber)) blocked = "Attendance is already taken for this period.";

    const window = { startTime: p.startTime, endTime: p.endTime };
    const byFaculty = new Map<string, { id: string; subjectName: string }[]>();
    for (const a of bySection.get(p.slot.sectionId) ?? []) {
      if (a.facultyId === requesterId) continue;
      byFaculty.set(a.facultyId, [...(byFaculty.get(a.facultyId) ?? []), { id: a.id, subjectName: a.subjectName }]);
    }
    const candidates: CandidateOption[] = [];
    for (const [fid, assignments] of byFaculty) {
      const f = people.get(fid);
      const day = days.get(fid);
      if (!f || !day) continue;
      const swaps: SwapOption[] = [];
      for (const q of day.periods) {
        if (!giveable(q, fid)) continue;
        const myAssignments = myBySection.get(q.slot.sectionId) ?? [];
        if (!myAssignments.length) continue;
        const qLock = slotLockId(date, { sectionId: q.slot.sectionId, day: q.slot.day, periodNumber: q.slot.periodNumber, fromFacultyId: fid });
        let qBlocked: string | null = null;
        if (date === today && q.startTime && q.startTime <= nowHHMM) qBlocked = "This period has already started.";
        else if (locked.has(qLock)) qBlocked = "This period is already in an adjustment.";
        else if (substituted.has(q.slot.id)) qBlocked = "A substitute is already covering this period.";
        else {
          // The requester must be free then (their own period being handed over doesn't count).
          const clash = clashWith(myBusy, { startTime: q.startTime, endTime: q.endTime }, [p.slot.id]);
          qBlocked = clash ? `${requester.name} is ${clash.label}.` : null;
        }
        swaps.push({
          slotId: q.slot.id, periodNumber: q.slot.periodNumber, startTime: q.startTime, endTime: q.endTime,
          sectionId: q.slot.sectionId, sectionName: (bySection.get(q.slot.sectionId)?.[0]?.sectionName) ?? myAssignSnap.docs.find((d) => d.get("sectionId") === q.slot.sectionId)?.get("sectionName") ?? "",
          subjectName: q.slot.subjectName, myAssignments, blocked: qBlocked,
        });
      }
      candidates.push({
        facultyId: fid, name: f.name, department: f.department ?? "", assignments,
        busy: busyMessage(f.name, clashWith(day.busy, window)),
        swaps,
      });
    }
    candidates.sort((a, b) => Number(!!a.busy) - Number(!!b.busy) || a.name.localeCompare(b.name));
    out.push({
      slotId: p.slot.id, periodNumber: p.slot.periodNumber, startTime: p.startTime, endTime: p.endTime,
      sectionId: p.slot.sectionId, sectionName, department: p.slot.department, subjectName: p.slot.subjectName,
      assignmentId: p.slot.assignmentId, blocked, candidates,
    });
  }
  return { requester, periods: out };
}

// ---------------------------------------------------------------------------------------------------------------

export interface CreateInput {
  kind: ClassAdjustmentKind;
  date: string;
  requesterFacultyId: string;
  slotId: string;
  toFacultyId: string;
  toAssignmentId: string;
  swapSlotId?: string;
  swapAssignmentId?: string;
  reason?: string;
}

/** asHod: arranged by an HOD - in force at once; every period must be in `hodDepartments`. */
export interface Actor { uid: string; name: string; asHod: boolean; hodDepartments?: string[] }

function legOf(p: PeriodOption, from: Faculty, to: Faculty, toAssignment: { id: string; subjectName: string }, toSubjectId: string,
  slot: FacultyPeriodOnDate): ClassAdjustmentLeg {
  return {
    slotId: p.slotId, day: slot.slot.day, periodNumber: p.periodNumber, startTime: p.startTime, endTime: p.endTime,
    department: slot.slot.department, courseId: slot.slot.courseId, year: slot.slot.year,
    ...(slot.slot.semester != null ? { semester: slot.slot.semester } : {}),
    sectionId: p.sectionId, sectionName: p.sectionName,
    ...(slot.slot.classroom ? { classroom: slot.slot.classroom } : {}),
    fromFacultyId: from.id, fromFacultyName: from.name, fromAssignmentId: slot.slot.assignmentId,
    fromSubjectId: slot.slot.subjectId, fromSubjectName: slot.slot.subjectName,
    toFacultyId: to.id, toFacultyName: to.name, toAssignmentId: toAssignment.id, toSubjectId, toSubjectName: toAssignment.subjectName,
  };
}

async function subjectIdOf(db: Firestore, c: string, assignmentId: string): Promise<string> {
  const snap = await col(db, c).collection("teachingAssignments").doc(assignmentId).get();
  return (snap.data() as TeachingAssignment | undefined)?.subjectId ?? "";
}

export async function createAdjustment(db: Firestore, c: string, actor: Actor, input: CreateInput): Promise<{ id: string; status: ClassAdjustment["status"] }> {
  const reason = (input.reason ?? "").trim().slice(0, MAX_REASON);
  if (input.kind !== "ADJUST" && input.kind !== "SWAP") throw new AdjustmentError("Select Adjust or Swap.");
  if (input.toFacultyId === input.requesterFacultyId) throw new AdjustmentError("Select a colleague.");
  const { requester, periods } = await buildOptions(db, c, input.requesterFacultyId, input.date);
  const p = periods.find((x) => x.slotId === input.slotId);
  if (!p) throw new AdjustmentError("This period is not on the timetable for that date.");
  if (p.blocked) throw new AdjustmentError(p.blocked, 409);
  const cand = p.candidates.find((x) => x.facultyId === input.toFacultyId);
  if (!cand) throw new AdjustmentError("This colleague doesn't teach that section, so they can't take the period with their own subject.");
  if (input.kind === "ADJUST" && cand.busy) throw new AdjustmentError(cand.busy, 409);
  const toAssignment = cand.assignments.find((a) => a.id === input.toAssignmentId);
  if (!toAssignment) throw new AdjustmentError("Select the subject the colleague will teach in that section.");

  const people = await loadFaculty(db, c, [input.toFacultyId]);
  const to = people.get(input.toFacultyId)!;
  const fromSlot = (await getFacultyPeriodsForDate(db, c, requester.id, input.date)).find((x) => x.slot.id === p.slotId)!;
  const legs: ClassAdjustmentLeg[] = [legOf(p, requester, to, toAssignment, await subjectIdOf(db, c, toAssignment.id), fromSlot)];

  if (input.kind === "SWAP") {
    const s = cand.swaps.find((x) => x.slotId === input.swapSlotId);
    if (!s) throw new AdjustmentError("Select the colleague's period you will take in return.");
    if (s.blocked) throw new AdjustmentError(s.blocked, 409);
    const mine = s.myAssignments.find((a) => a.id === input.swapAssignmentId);
    if (!mine) throw new AdjustmentError("Select the subject you will teach in that period.");
    // The colleague must be free at the swap period's time once their own period there is handed back.
    const back = (await getFacultyPeriodsForDate(db, c, to.id, input.date)).find((x) => x.slot.id === s.slotId);
    if (!back) throw new AdjustmentError("That period is not on the colleague's timetable for that date.");
    if (await sessionExists(db, c, back.slot.assignmentId, input.date, back.slot.periodNumber)) throw new AdjustmentError("Attendance is already taken for the colleague's period.", 409);
    const clash = clashWith((await busyOf(db, c, to, input.date)).busy, { startTime: p.startTime, endTime: p.endTime }, [s.slotId]);
    if (clash) throw new AdjustmentError(busyMessage(to.name, clash)!, 409);
    const swapOpt: PeriodOption = { ...p, slotId: s.slotId, periodNumber: s.periodNumber, startTime: s.startTime, endTime: s.endTime, sectionId: s.sectionId, sectionName: s.sectionName, assignmentId: back.slot.assignmentId, subjectName: back.slot.subjectName, department: back.slot.department, blocked: null, candidates: [] };
    legs.push(legOf(swapOpt, to, requester, mine, await subjectIdOf(db, c, mine.id), back));
  }

  if (actor.asHod) {
    const outside = legs.find((l) => !(actor.hodDepartments ?? []).includes(l.department));
    if (outside) throw new AdjustmentError(`${outside.sectionName} is not in your department, so you can't arrange this.`, 403);
  }

  const now = new Date();
  const status: ClassAdjustment["status"] = actor.asHod ? "ACCEPTED" : "PENDING";
  const ref = col(db, c).collection("classAdjustments").doc();
  const doc: ClassAdjustment = {
    kind: input.kind, date: input.date, status,
    requesterFacultyId: requester.id, requesterName: requester.name,
    counterpartFacultyId: to.id, counterpartName: to.name,
    facultyIds: [requester.id, to.id],
    departmentNames: [...new Set(legs.map((l) => l.department).filter(Boolean))],
    legs, ...(reason ? { reason } : {}),
    createdByUid: actor.uid, createdByName: actor.name, createdBy: actor.asHod ? "HOD" : "FACULTY",
    ...(actor.asHod ? { respondedAt: now, respondedByName: actor.name } : {}),
    createdAt: now, updatedAt: now,
  };
  await db.runTransaction(async (tx) => {
    const lockRefs = legs.map((l) => col(db, c).collection(LOCKS).doc(slotLockId(input.date, l)));
    const locks = await Promise.all(lockRefs.map((r) => tx.get(r)));
    if (locks.some((l) => l.exists)) throw new AdjustmentError("This period is already in an adjustment.", 409);
    lockRefs.forEach((r) => tx.set(r, { date: input.date, adjustmentId: ref.id, createdAt: now }));
    tx.set(ref, doc);
  });
  invalidateClassAdjustmentCache(c);

  await writeAuditLogSafe(db, c, {
    action: "CLASS_ADJUSTMENT_CREATED", performedBy: actor.uid, performedByName: actor.name, targetId: ref.id,
    details: { kind: input.kind, date: input.date, status, legs: legs.map(summaryOf) },
  });
  const what = describe(doc);
  if (actor.asHod) {
    for (const f of [requester, to]) await notifyFaculty(db, c, f.id, "CLASS_ADJUSTMENT_ARRANGED", "Class adjusted by HOD", `${actor.name} arranged: ${what}.`);
  } else {
    await notifyFaculty(db, c, to.id, "CLASS_ADJUSTMENT_REQUEST", input.kind === "SWAP" ? "Class swap request" : "Class adjustment request",
      `${requester.name} asks you to ${input.kind === "SWAP" ? "swap" : "take"}: ${what}. Accept or decline on Work Adjustments.`);
  }
  if (actor.asHod) await notifyHodsOf(db, c, doc, "CLASS_ADJUSTMENT_ARRANGED", "Class adjusted", `${actor.name} arranged: ${what}.`, actor.uid);
  return { id: ref.id, status };
}

function summaryOf(l: ClassAdjustmentLeg) {
  return `${l.sectionName} ${periodLabel(l)}: ${l.fromFacultyName} (${l.fromSubjectName}) -> ${l.toFacultyName} (${l.toSubjectName})`;
}

export function describe(a: Pick<ClassAdjustment, "date" | "legs">): string {
  return `${dmy(a.date)} - ${a.legs.map((l) => `${l.sectionName} ${periodLabel(l)} to ${l.toFacultyName} (${l.toSubjectName})`).join("; ")}`;
}

async function notifyFaculty(db: Firestore, c: string, facultyId: string, type: string, title: string, message: string) {
  const uid = await resolveLoginUidForFacultyMember(db, c, facultyId);
  if (uid && uid !== facultyId) await notify(db, c, uid, type, title, message, PAGE_LINK);
}

async function notifyHodsOf(db: Firestore, c: string, a: ClassAdjustment, type: string, title: string, message: string, skipUid?: string) {
  const uids = new Set((await Promise.all(a.departmentNames.map((d) => getDepartmentHeadUids(db, c, d)))).flat());
  for (const uid of uids) if (uid !== skipUid) await notify(db, c, uid, type, title, message, PAGE_LINK);
}

// ---------------------------------------------------------------------------------------------------------------

export type Action = "ACCEPT" | "DECLINE" | "CANCEL";

export async function actOn(
  db: Firestore, c: string, id: string, action: Action,
  who: { uid: string; name: string; facultyId: string; hodDepartments: string[] },
  reasonIn?: string,
): Promise<ClassAdjustment["status"]> {
  const ref = col(db, c).collection("classAdjustments").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new AdjustmentError("Class adjustment not found. It may have been deleted.", 404);
  const a = snap.data() as ClassAdjustment;
  const reason = (reasonIn ?? "").trim().slice(0, MAX_REASON);
  const isCounterpart = a.counterpartFacultyId === who.facultyId;
  const isRequester = a.requesterFacultyId === who.facultyId;
  const isHod = a.departmentNames.some((d) => who.hodDepartments.includes(d));

  if (action === "ACCEPT" || action === "DECLINE") {
    if (!isCounterpart) throw new AdjustmentError("Only the colleague asked can accept or decline this.", 403);
    if (a.status !== "PENDING") throw new AdjustmentError("This request has already been answered or cancelled.", 409);
  } else {
    if (!isCounterpart && !isRequester && !isHod) throw new AdjustmentError("You can't cancel this adjustment.", 403);
    if (a.status !== "PENDING" && a.status !== "ACCEPTED") throw new AdjustmentError("This adjustment is no longer open.", 409);
    for (const l of a.legs) {
      if (await sessionExists(db, c, l.toAssignmentId, a.date, l.periodNumber)) {
        throw new AdjustmentError(`Attendance is already taken for ${l.sectionName} ${periodLabel(l)} under this adjustment, so it can't be cancelled.`, 409);
      }
    }
  }

  if (action === "ACCEPT") {
    if (a.date < todayIST()) throw new AdjustmentError("This date has passed.", 409);
    // Re-check: the person taking each period is still free then (their day may have changed since the request).
    const people = await loadFaculty(db, c, a.facultyIds);
    for (const l of a.legs) {
      const taker = people.get(l.toFacultyId);
      if (!taker) continue;
      const { busy } = await busyOf(db, c, taker, a.date);
      const own = a.legs.filter((x) => x.fromFacultyId === taker.id).map((x) => x.slotId);
      const clash = clashWith(busy, { startTime: l.startTime ?? "", endTime: l.endTime ?? "" }, own);
      if (clash) throw new AdjustmentError(busyMessage(taker.name, clash)!, 409);
      if (await sessionExists(db, c, l.fromAssignmentId, a.date, l.periodNumber)) throw new AdjustmentError("Attendance is already taken for this period.", 409);
    }
  }

  const now = new Date();
  const next: ClassAdjustment["status"] = action === "ACCEPT" ? "ACCEPTED" : action === "DECLINE" ? "DECLINED" : "CANCELLED";
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    const cur = fresh.data() as ClassAdjustment | undefined;
    if (!cur || cur.status !== a.status) throw new AdjustmentError("This adjustment was changed meanwhile. Reload and try again.", 409);
    tx.update(ref, {
      status: next, updatedAt: now,
      ...(action === "CANCEL"
        ? { cancelledAt: now, cancelledByName: who.name, ...(reason ? { cancelReason: reason } : {}) }
        : { respondedAt: now, respondedByName: who.name, ...(action === "DECLINE" && reason ? { declineReason: reason } : { declineReason: FieldValue.delete() }) }),
    });
    if (next !== "ACCEPTED") for (const l of a.legs) tx.delete(col(db, c).collection(LOCKS).doc(slotLockId(a.date, l)));
  });
  invalidateClassAdjustmentCache(c);

  await writeAuditLogSafe(db, c, {
    action: `CLASS_ADJUSTMENT_${next}`, performedBy: who.uid, performedByName: who.name, targetId: id,
    details: { kind: a.kind, date: a.date, legs: a.legs.map(summaryOf), ...(reason ? { reason } : {}) },
  });
  const what = describe(a);
  if (action === "ACCEPT") {
    await notifyFaculty(db, c, a.requesterFacultyId, "CLASS_ADJUSTMENT_ACCEPTED", "Class adjustment accepted", `${a.counterpartName} accepted: ${what}.`);
    await notifyHodsOf(db, c, a, "CLASS_ADJUSTMENT_ACCEPTED", "Class adjusted", `${a.requesterName} and ${a.counterpartName}: ${what}.`);
  } else if (action === "DECLINE") {
    await notifyFaculty(db, c, a.requesterFacultyId, "CLASS_ADJUSTMENT_DECLINED", "Class adjustment declined", `${a.counterpartName} declined: ${what}.${reason ? ` Reason: ${reason}` : ""}`);
  } else {
    for (const fid of a.facultyIds) {
      if (fid === who.facultyId) continue;
      await notifyFaculty(db, c, fid, "CLASS_ADJUSTMENT_CANCELLED", "Class adjustment cancelled", `${who.name} cancelled: ${what}.${reason ? ` Reason: ${reason}` : ""}`);
    }
    if (a.status === "ACCEPTED" && !isHod) await notifyHodsOf(db, c, a, "CLASS_ADJUSTMENT_CANCELLED", "Class adjustment cancelled", `${who.name} cancelled: ${what}.`);
  }
  return next;
}

// ---------------------------------------------------------------------------------------------------------------

export type AdjustmentRow = ClassAdjustment & { id: string };

function plain(a: ClassAdjustment, id: string): AdjustmentRow {
  const ts = (v: unknown) => (v && typeof (v as { toDate?: () => Date }).toDate === "function" ? (v as { toDate: () => Date }).toDate().toISOString() : v instanceof Date ? v.toISOString() : v ?? null);
  return { ...a, id, createdAt: ts(a.createdAt), updatedAt: ts(a.updatedAt), respondedAt: ts(a.respondedAt), cancelledAt: ts(a.cancelledAt) };
}

/** The faculty member's own adjustments (asked by or of them), newest date first. */
export async function listMine(db: Firestore, c: string, facultyId: string): Promise<AdjustmentRow[]> {
  const snap = await col(db, c).collection("classAdjustments").where("facultyIds", "array-contains", facultyId).get();
  return sortRows(snap.docs.map((d) => plain(d.data() as ClassAdjustment, d.id))).slice(0, 100);
}

/** The HOD's departments' adjustments from 30 days back. */
export async function listForDepartments(db: Firestore, c: string, departments: string[]): Promise<AdjustmentRow[]> {
  if (!departments.length) return [];
  const from = new Date(`${todayIST()}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 30);
  const snap = await col(db, c).collection("classAdjustments").where("date", ">=", from.toISOString().slice(0, 10)).get();
  const set = new Set(departments);
  return sortRows(snap.docs.map((d) => plain(d.data() as ClassAdjustment, d.id)).filter((a) => a.departmentNames.some((d) => set.has(d)))).slice(0, 300);
}

function sortRows(rows: AdjustmentRow[]): AdjustmentRow[] {
  return rows.sort((x, y) => y.date.localeCompare(x.date) || String(y.createdAt).localeCompare(String(x.createdAt)));
}

export async function facultyName(db: Firestore, c: string, facultyId: string): Promise<string> {
  return (await loadFaculty(db, c, [facultyId])).get(facultyId)?.name ?? "";
}

/** Faculty of the HOD's departments (for "arrange for"). */
export async function departmentFaculty(db: Firestore, c: string, departments: string[]): Promise<{ id: string; name: string; department: string }[]> {
  const out: { id: string; name: string; department: string }[] = [];
  for (let i = 0; i < departments.length; i += 30) {
    const snap = await col(db, c).collection("facultyMembers").where("department", "in", departments.slice(i, i + 30)).get();
    for (const d of snap.docs) {
      const f = d.data() as FacultyMember;
      if (f.status === "RESIGNED" || f.status === "RETIRED") continue;
      out.push({ id: d.id, name: facultyDisplayName(f), department: f.department ?? "" });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
