import type { StudentAttendanceMark } from "@/types";

// The marking mode picked at the top of an attendance grid. One switch per student / period then means:
//   ABSENTEES  - everyone starts Present; a switched-on cell is Absent.
//   PRESENTEES - everyone starts Absent; a switched-on cell is Present.
// Shared by the faculty's Mark Attendance page and the Department Office's Edit Attendance panel.

export type AttendanceMode = "ABSENTEES" | "PRESENTEES";

/** What a switched-on cell means in this mode (Present when no mode is picked yet). */
export function checkedMeaningFor(mode: AttendanceMode | null): StudentAttendanceMark {
  return mode === "ABSENTEES" ? "ABSENT" : "PRESENT";
}

/** What an untouched cell starts as in this mode. */
export function defaultFillFor(mode: AttendanceMode): StudentAttendanceMark {
  return mode === "ABSENTEES" ? "PRESENT" : "ABSENT";
}
