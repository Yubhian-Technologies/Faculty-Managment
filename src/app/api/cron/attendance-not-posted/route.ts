export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { getNotPostedSettings, markSweptToday } from "@/lib/attendance/notPostedSettings";
import { istDateKey, istTimeHHMM } from "@/lib/attendance/istTime";
import { DAY_BY_JS_DAY, getFacultyPeriodsForDate } from "@/lib/timetable/currentPeriod";
import { resolvePeriodCompletionStatus } from "@/lib/attendance/periodAttendanceStatus";
import { emitWorkflowNotification } from "@/lib/notifications/workflowNotifications";
import type { FacultyMember, StudentAttendanceSession } from "@/types";

// Not a user-facing route - hit on a schedule (see functions/src/index.ts,
// or any external scheduler pointed at this URL) with a shared secret, the
// same convention a scheduler-triggered route needs regardless of which
// scheduler ends up calling it. No session/cookie auth applies here at all.
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed - never run unconfigured
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

// For one college: whichever faculty have a published class today, whose
// period has already ended with no SUBMITTED studentAttendance session, get
// one notification each (deduped per faculty per day). Reuses the exact
// same period-window and completion-status logic the "Not Posted Faculty"
// report and Faculty Attendance Completion view already use, so this sweep
// can never disagree with what a human reviewing those reports would see.
async function sweepCollege(db: FirebaseFirestore.Firestore, collegeId: string, now: Date): Promise<{ swept: boolean; notified: number }> {
  const settings = await getNotPostedSettings(db, collegeId);
  if (!settings.enabled) return { swept: false, notified: 0 };

  const today = istDateKey(now);
  if (settings.lastRunDate === today) return { swept: false, notified: 0 };
  if (istTimeHHMM(now) < settings.cutoffTime) return { swept: false, notified: 0 };

  const collegeRef = db.collection("colleges").doc(collegeId);
  const [y, m, d] = today.split("-").map(Number);
  const jsDay = new Date(y, m - 1, d).getDay();
  const dayName = DAY_BY_JS_DAY[jsDay];
  if (!dayName) {
    // Sunday - nothing scheduled college-wide. Still mark swept so this
    // college doesn't get re-checked on every tick for the rest of the day.
    await markSweptToday(db, collegeId, today);
    return { swept: true, notified: 0 };
  }

  const todaySlotsSnap = await collegeRef.collection("timetableSlots").where("day", "==", dayName).get();
  const facultyIds = [...new Set(todaySlotsSnap.docs.map((s) => (s.data() as { facultyId?: string }).facultyId).filter((v): v is string => !!v))];

  let notified = 0;
  for (const facultyId of facultyIds) {
    const periods = await getFacultyPeriodsForDate(db, collegeId, facultyId, today);
    if (periods.length === 0) continue;

    const sessionSnaps = await Promise.all(
      periods.map((p) => collegeRef.collection("studentAttendance").doc(`${p.slot.assignmentId}_${today}_${p.slot.periodNumber}`).get())
    );
    const missed = periods.filter((p, i) => {
      const snap = sessionSnaps[i];
      const session = snap.exists ? (snap.data() as StudentAttendanceSession) : null;
      return resolvePeriodCompletionStatus({ dateISO: today, endTime: p.endTime, session, now }) === "NOT_MARKED";
    });
    if (missed.length === 0) continue;

    // StudentAttendanceSession.facultyId (what notify() needs) is the LOGIN
    // uid, not the facultyMembers doc id timetableSlots.facultyId already is
    // - same resolution office-correction/route.ts already does.
    const facultySnap = await collegeRef.collection("facultyMembers").doc(facultyId).get();
    if (!facultySnap.exists) continue;
    const faculty = facultySnap.data() as FacultyMember;
    const toUid = faculty.userUid ?? facultyId;

    const subjectNames = [...new Set(missed.map((p) => p.slot.subjectName).filter(Boolean))];
    const title = missed.length === 1 ? "Attendance not posted" : `Attendance not posted (${missed.length} periods)`;
    const message = `You haven't posted student attendance for ${subjectNames.join(", ") || "today's class"} - contact your Department Office if the window has closed.`;

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
      dedupeKey: `attendance-not-posted:${collegeId}:${facultyId}:${today}`,
      // A plain reminder, not a workflow item with an owner/approval step -
      // no resolveWorkflowNotifications call anywhere clears it, so it must
      // never surface as the persistent "must act" login popup actionable
      // notifications default to.
      actionable: false,
    });
    notified++;
  }

  await markSweptToday(db, collegeId, today);
  return { swept: true, notified };
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = getAdminDb();
    const now = new Date();
    const collegesSnap = await db.collection("colleges").get();
    const results = await Promise.all(collegesSnap.docs.map((c) => sweepCollege(db, c.id, now)));
    const swept = results.filter((r) => r.swept).length;
    const notified = results.reduce((sum, r) => sum + r.notified, 0);
    return NextResponse.json({ collegesChecked: results.length, collegesSwept: swept, facultyNotified: notified });
  } catch (err) {
    console.error("[cron/attendance-not-posted]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
