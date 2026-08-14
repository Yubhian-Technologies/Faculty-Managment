// "Late" is a purely display-time derivation from the already-recorded
// check-in — never written to Firestore, never affects attendance status or
// calculations. Shared by Faculty's own Daily Records view and the HOD/
// Principal attendance report view so everyone derives it the same way from
// the same recorded checkIn ("HH:MM", 24h) value.
const LATE_CUTOFF_MINUTES = 9 * 60 + 5; // 09:05 — this exact minute still counts as on time

export function isLateCheckIn(checkIn: string | null | undefined): boolean {
  if (!checkIn) return false;
  const match = /^(\d{1,2}):(\d{2})$/.exec(checkIn);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return false;
  return hours * 60 + minutes > LATE_CUTOFF_MINUTES;
}
