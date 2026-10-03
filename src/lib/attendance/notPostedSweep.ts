import type { Firestore } from "firebase-admin/firestore";
import { getNotPostedSettings, markSweptToday } from "@/lib/attendance/notPostedSettings";
import { istDateKey, istTimeHHMM } from "@/lib/attendance/istTime";
import { DAY_BY_JS_DAY, getFacultyPeriodsForDate, type TimingCache } from "@/lib/timetable/currentPeriod";
import { resolvePeriodCompletionStatus } from "@/lib/attendance/periodAttendanceStatus";
import { getNoClassReason } from "@/lib/studentAttendance/classDay";
import { emitWorkflowNotification } from "@/lib/notifications/workflowNotifications";
import type { FacultyMember, StudentAttendanceSession } from "@/types";

// The "attendance not posted" reminder sweep (audit F-45).
//
// For one college: whichever faculty have a published class today, whose
// period has already ended with no SUBMITTED studentAttendance session, are
// told. Reuses the exact same period-window and completion-status logic the
// "Not Posted Faculty" report and Faculty Attendance Completion view use, so
// the sweep can never disagree with what a human reviewing those would see.
//
// What changed from "once per faculty per day":
//   - Deduped PER PERIOD. Each missed period is claimed by a marker document
//     (attendanceNotPostedSent/{faculty}_{date}_{assignment}_{period}) written
//     once its notification went out, so a period is reported exactly once no
//     matter how many ticks, retries or partial failures happen - and a period
//     that only ends (or is only missed) after an earlier tick is still reported
//     on a later one, where the old per-day key silently swallowed it.
//   - The college is only marked "swept for today" once nothing is still to
//     come - every period of the day has ended and every faculty was handled
//     without error. Until then each 15-minute tick looks again (cheaply: the
//     common case is the first tick after the cutoff finishing the day).
//   - A failure for one faculty no longer abandons the rest, and a failure for
//     one college no longer abandons the others; failures are recorded
//     (systemJobs/attendance-not-posted) and surfaced as a non-2xx response so
//     the scheduler and its log-based alerts see them instead of a silent 200.

export interface CollegeSweepResult {
  swept: boolean;
  /** Faculty who received a notification this run. */
  notified: number;
  /** Individual periods reported this run. */
  periodsNotified: number;
}

const markerRef = (db: Firestore, collegeId: string, key: string) =>
  db.collection("colleges").doc(collegeId).collection("attendanceNotPostedSent").doc(key);

export async function sweepCollege(db: Firestore, collegeId: string, now: Date): Promise<CollegeSweepResult> {
  const settings = await getNotPostedSettings(db, collegeId);
  if (!settings.enabled) return { swept: false, notified: 0, periodsNotified: 0 };

  const today = istDateKey(now);
  if (settings.lastRunDate === today) return { swept: false, notified: 0, periodsNotified: 0 };
  if (istTimeHHMM(now) < settings.cutoffTime) return { swept: false, notified: 0, periodsNotified: 0 };

  // Nobody is expected to post attendance on a holiday / summer break / a day
  // outside the college's working days - mark swept so it isn't rechecked.
  if (await getNoClassReason(db, collegeId, today)) {
    await markSweptToday(db, collegeId, today);
    return { swept: true, notified: 0, periodsNotified: 0 };
  }

  const collegeRef = db.collection("colleges").doc(collegeId);
  const timingCache: TimingCache = new Map();
  const [y, m, d] = today.split("-").map(Number);
  const dayName = DAY_BY_JS_DAY[new Date(y, m - 1, d).getDay()];
  if (!dayName) {
    // Sunday - nothing scheduled college-wide. Still mark swept so this
    // college doesn't get re-checked on every tick for the rest of the day.
    await markSweptToday(db, collegeId, today);
    return { swept: true, notified: 0, periodsNotified: 0 };
  }

  const todaySlotsSnap = await collegeRef.collection("timetableSlots").where("day", "==", dayName).get();
  const facultyIds = [...new Set(todaySlotsSnap.docs.map((s) => (s.data() as { facultyId?: string }).facultyId).filter((v): v is string => !!v))];

  let notified = 0;
  let periodsNotified = 0;
  let stillToCome = false;
  const failures: { facultyId: string; error: unknown }[] = [];

  for (const facultyId of facultyIds) {
    try {
      const periods = await getFacultyPeriodsForDate(db, collegeId, facultyId, today, timingCache);
      if (periods.length === 0) continue;

      const sessionSnaps = await Promise.all(
        periods.map((p) => collegeRef.collection("studentAttendance").doc(`${p.slot.assignmentId}_${today}_${p.slot.periodNumber}`).get())
      );
      const missed = periods.filter((p, i) => {
        const snap = sessionSnaps[i];
        const session = snap.exists ? (snap.data() as StudentAttendanceSession) : null;
        const status = resolvePeriodCompletionStatus({ dateISO: today, endTime: p.endTime, session, now });
        if (status === "PENDING") stillToCome = true;
        return status === "NOT_MARKED";
      });
      if (missed.length === 0) continue;

      // Only the periods not already reported.
      const keyOf = (p: (typeof missed)[number]) => `${facultyId}_${today}_${p.slot.assignmentId}_${p.slot.periodNumber}`;
      const markers = await db.getAll(...missed.map((p) => markerRef(db, collegeId, keyOf(p))));
      const fresh = missed.filter((_, i) => !markers[i].exists);
      if (fresh.length === 0) continue;

      // StudentAttendanceSession.facultyId (what notify() needs) is the LOGIN
      // uid, not the facultyMembers doc id timetableSlots.facultyId already is
      // - same resolution office-correction/route.ts already does.
      const facultySnap = await collegeRef.collection("facultyMembers").doc(facultyId).get();
      if (!facultySnap.exists) continue;
      const faculty = facultySnap.data() as FacultyMember;
      const toUid = faculty.userUid ?? facultyId;

      const subjectNames = [...new Set(fresh.map((p) => p.slot.subjectName).filter(Boolean))];
      const title = fresh.length === 1 ? "Attendance not posted" : `Attendance not posted (${fresh.length} periods)`;
      const message = `You haven't posted student attendance for ${subjectNames.join(", ") || "today's class"} - contact your Department Office if the window has closed.`;
      const freshKeys = fresh.map(keyOf).sort();

      await emitWorkflowNotification({
        db,
        collegeId,
        toUid,
        type: "ATTENDANCE_NOT_POSTED",
        title,
        message,
        link: "/panel/mark-attendance",
        entityType: "attendanceNotPosted",
        entityId: `${facultyId}_${today}`,
        // Keyed by exactly the periods in it: retrying the same set (a crash
        // between this and the markers below) is a no-op, a different set is a
        // different, new notification.
        dedupeKey: `attendance-not-posted:${collegeId}:${freshKeys.join("+")}`,
        // A plain reminder, not a workflow item with an owner/approval step -
        // no resolveWorkflowNotifications call anywhere clears it, so it must
        // never surface as the persistent "must act" login popup actionable
        // notifications default to.
        actionable: false,
      });

      // Claim the periods only AFTER the notification went out: a crash in
      // between repeats an idempotent notification, never loses one.
      const batch = db.batch();
      for (const p of fresh) {
        batch.set(markerRef(db, collegeId, keyOf(p)), {
          collegeId, facultyId, date: today, assignmentId: p.slot.assignmentId, periodNumber: p.slot.periodNumber, notifiedAt: now,
        });
      }
      await batch.commit();
      notified++;
      periodsNotified += fresh.length;
    } catch (error) {
      failures.push({ facultyId, error });
    }
  }

  if (failures.length > 0) {
    // Not marked swept: the next tick resumes, and the markers make that safe.
    const first = failures[0].error;
    throw new Error(
      `${failures.length} of ${facultyIds.length} faculty failed during the not-posted sweep (first: ${first instanceof Error ? first.message : String(first)})`
    );
  }

  // Everything that has ended was handled and nothing is still to come: done for today.
  if (!stillToCome) {
    await markSweptToday(db, collegeId, today);
    return { swept: true, notified, periodsNotified };
  }
  return { swept: false, notified, periodsNotified };
}

export interface SweepRunResult {
  collegesChecked: number;
  collegesSwept: number;
  facultyNotified: number;
  periodsNotified: number;
  failed: { collegeId: string; error: string }[];
}

const HEARTBEAT = ["systemJobs", "attendance-not-posted"] as const;

/** Sweeps every college, isolating failures, and records a heartbeat a monitor can read. */
export async function runNotPostedSweep(db: Firestore, now: Date = new Date()): Promise<SweepRunResult> {
  const collegesSnap = await db.collection("colleges").get();
  const settled = await Promise.allSettled(collegesSnap.docs.map((c) => sweepCollege(db, c.id, now)));

  const result: SweepRunResult = {
    collegesChecked: settled.length, collegesSwept: 0, facultyNotified: 0, periodsNotified: 0, failed: [],
  };
  settled.forEach((r, i) => {
    const collegeId = collegesSnap.docs[i].id;
    if (r.status === "fulfilled") {
      if (r.value.swept) result.collegesSwept++;
      result.facultyNotified += r.value.notified;
      result.periodsNotified += r.value.periodsNotified;
    } else {
      const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
      result.failed.push({ collegeId, error });
      // Structured so a log-based alert can match on the job name.
      console.error("[job:attendance-not-posted] college sweep failed", { collegeId, error });
    }
  });

  try {
    const ref = db.collection(HEARTBEAT[0]).doc(HEARTBEAT[1]);
    const previous = ((await ref.get()).data() as { consecutiveFailures?: number } | undefined)?.consecutiveFailures ?? 0;
    const failed = result.failed.length > 0;
    await ref.set(
      {
        lastRunAt: now,
        ...(failed
          ? { lastFailureAt: now, lastError: result.failed[0].error, failedColleges: result.failed.map((f) => f.collegeId), consecutiveFailures: previous + 1 }
          : { lastOkAt: now, failedColleges: [], lastError: "", consecutiveFailures: 0 }),
        collegesChecked: result.collegesChecked,
        periodsNotified: result.periodsNotified,
      },
      { merge: true }
    );
  } catch (err) {
    // The heartbeat is a monitoring aid; losing one write must not fail the sweep itself.
    console.error("[job:attendance-not-posted] could not record heartbeat", err);
  }

  return result;
}
