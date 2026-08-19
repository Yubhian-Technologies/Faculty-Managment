// "Late" is a purely display-time derivation from the already-recorded
// check-in — never written to Firestore, never affects attendance status or
// calculations. Shared by Faculty's own Daily Records view and the HOD/
// Principal attendance report view so everyone derives it the same way from
// the same recorded checkIn ("HH:MM", 24h) value.
const LATE_CUTOFF_MINUTES = 9 * 60 + 5; // 09:05 — this exact minute still counts as on time

function toMinutes(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

// `permittedCheckInTime` being present at all means an HOD granted this
// person a check-in exception for this specific day (see
// AttendanceCheckInPermission / AttendanceRecord.permittedCheckInTime) - a
// full exemption for the whole day, not a raised-but-still-enforced cutoff.
// Arriving at 11am under a permission granted for 9:30 is still never late -
// the HOD already decided this day doesn't count, the exact time on the
// permission is a record of what was agreed, not a second cutoff to police.
export function isLateCheckIn(checkIn: string | null | undefined, permittedCheckInTime?: string | null): boolean {
  if (!checkIn) return false;
  if (permittedCheckInTime) return false;
  const actual = toMinutes(checkIn);
  if (actual === null) return false;
  return actual > LATE_CUTOFF_MINUTES;
}
