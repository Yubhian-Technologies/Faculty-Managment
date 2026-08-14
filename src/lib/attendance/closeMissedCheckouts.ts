// This project has no cron/scheduled-job infrastructure to flip an
// incomplete day to Absent right at midnight (checked: no Cloud Functions,
// no Vercel cron config). Instead, every place that reads attendanceRecords
// - self "My Attendance", HOD/Principal's daily roster report, Management's
// views - calls closeMissedCheckouts() first: any PAST day (never "today",
// which is still in progress) where the person checked in but never checked
// out gets corrected to Absent and persisted right there, so the fix sticks
// in Firestore and every subsequent viewer sees it immediately without
// redoing the check.
export const MISSED_CHECKOUT_REMARK = "Attendance portal closed — checked in but not checked out, so marked absent";

// Firestore Timestamp (has .toDate) or a plain ISO/date string, depending on
// how the record was written - every attendance route resolves this the same
// way before comparing dates.
export function toAttendanceDate(raw: unknown): Date | null {
  if (!raw) return null;
  const withToDate = raw as { toDate?: () => Date };
  if (typeof withToDate.toDate === "function") return withToDate.toDate();
  const d = new Date(raw as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface Correctable {
  ref: FirebaseFirestore.DocumentReference;
  // Named distinctly from AttendanceRecord's own raw `date` field (a
  // Firestore Timestamp/string) - callers pass the SAME object they'll
  // return in their response (with this resolved JS Date attached
  // alongside), so the in-place status/remarks mutation below is visible to
  // them without a separate merge step.
  resolvedDate: Date | null;
  status: string;
  checkIn?: string | null;
  checkOut?: string | null;
  remarks?: string | null;
}

export async function closeMissedCheckouts<T extends Correctable>(
  db: FirebaseFirestore.Firestore,
  records: T[]
): Promise<void> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const toFix = records.filter(
    (r) => r.status === "PRESENT" && !!r.checkIn && !r.checkOut && r.resolvedDate !== null && r.resolvedDate < todayStart
  );
  if (toFix.length === 0) return;

  const batch = db.batch();
  for (const r of toFix) {
    batch.update(r.ref, { status: "ABSENT", remarks: MISSED_CHECKOUT_REMARK, updatedAt: now });
    r.status = "ABSENT";
    r.remarks = MISSED_CHECKOUT_REMARK;
  }
  await batch.commit();
}
