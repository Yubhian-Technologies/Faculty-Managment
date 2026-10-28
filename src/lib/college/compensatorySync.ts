import type { Firestore } from "firebase-admin/firestore";
import { istDateFromParts } from "@/lib/attendance/istTime";
import { WORKING_DAY_ELIGIBLE_ROLES } from "@/lib/attendance/workingDays";
import { academicSessionLabel } from "@/lib/college/academicSession";

// April cutoff, same convention as academicSession.ts's currentAcademicStartYear -
// a Jan/Feb/Mar date belongs to the session that started the previous April.
export function academicYearForDate(date: Date): string {
  const startYear = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return academicSessionLabel(startYear);
}

// Faculty/staff side of a compensatory Sunday. Students read the holiday doc
// directly (classDay.ts), but staff attendance and leave counting read the
// Working Day overrides (workingDays.ts), so switching a compensatory Sunday on
// writes one override for every eligible role and switching it off removes it.
// The override's id is derived from the holiday, so it can never duplicate and
// is easy to remove with the holiday.
const overrideRef = (db: Firestore, collegeId: string, holidayId: string) =>
  db.collection("colleges").doc(collegeId).collection("workingDays").doc(`comp_${holidayId}`);

export async function syncCompensatoryWorkingDay(
  db: Firestore,
  collegeId: string,
  holiday: { id: string; name: string; enabled: boolean; dateKey?: string }
): Promise<void> {
  const ref = overrideRef(db, collegeId, holiday.id);
  if (!holiday.enabled || !holiday.dateKey) {
    await ref.delete();
    return;
  }
  const [y, m, d] = holiday.dateKey.split("-").map(Number);
  const date = istDateFromParts(y, m, d);
  await ref.set({
    collegeId,
    date,
    reason: `Compensatory working day for ${holiday.name}`,
    roles: WORKING_DAY_ELIGIBLE_ROLES,
    isHalfDay: false,
    academicYear: academicYearForDate(date),
    holidayId: holiday.id,
    createdAt: new Date(),
  });
}
