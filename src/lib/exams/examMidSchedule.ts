import type { Firestore } from "firebase-admin/firestore";
import type { ExamMidSettings } from "@/types";

// Defense in depth for the client's own `min` date-picker constraint - see
// exam-circulars/route.ts's isPastDate for why UTC-as-floor is safe here.
function isPastDate(dateStr: string): boolean {
  return dateStr < new Date().toISOString().slice(0, 10);
}

export interface MidSchedulePayload {
  courseId?: string;
  courseName?: string;
  semester?: number;
  totalSemesters?: number;
  midNumber?: number;
  fromDate?: string;
  toDate?: string;
  fromTime?: string;
  toTime?: string;
}

// Shared by POST (exam-mid-schedules/route.ts) and PATCH ([id]/route.ts) -
// every field is always re-validated in full since edits are unrestricted
// (no locked fields). Re-checks midNumber against the college's saved
// ExamMidSettings server-side - defense against a stale/tampered client
// dropdown, same spirit as exam-configurations' course/department scope check.
export async function validateMidSchedule(
  db: Firestore,
  collegeId: string,
  body: MidSchedulePayload
): Promise<string | null> {
  const { courseName, semester, totalSemesters, midNumber, fromDate, toDate, fromTime, toTime } = body;

  if (!courseName) return "Course is required";
  if (!semester || !totalSemesters) return "Semester is required";
  if (!midNumber) return "Mid is required";
  if (!fromDate || !toDate) return "Date range is required";
  if (!fromTime || !toTime) return "Time range is required";
  if (isPastDate(fromDate)) return "From date cannot be in the past";
  if (toDate < fromDate) return "\"To date\" cannot be before \"From date\"";
  if (fromDate === toDate && toTime <= fromTime) return "\"To time\" must be after \"From time\" on the same day";

  const settingsSnap = await db.collection("colleges").doc(collegeId).collection("examSettings").doc("mid").get();
  const midCount = settingsSnap.exists ? (settingsSnap.data() as ExamMidSettings).midCount : 0;
  if (!midCount || midNumber < 1 || midNumber > midCount) {
    return `Mid must be between 1 and ${midCount || 0}. Set the mid count in Settings first.`;
  }

  return null;
}
