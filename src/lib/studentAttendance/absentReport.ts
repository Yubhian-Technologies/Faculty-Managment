import { calcPercent } from "./percentage";
import { isShortageByPercent } from "./shortage";

export interface StudentAgg {
  studentId: string;
  rollNumber: string;
  name: string;
  held: number;
  attend: number;
  percent: number | null;
}

export function toAbsentList(students: StudentAgg[]): StudentAgg[] {
  return students.filter((s) => s.held > 0 && s.attend < s.held);
}

export function toShortageList(students: StudentAgg[], threshold = 75): StudentAgg[] {
  return students.filter((s) => isShortageByPercent(s.percent, threshold));
}

// For daily subject-wise where status map is P/A/null per student
export function isAbsentDaily(status: string | null | undefined): boolean {
  return status === "ABSENT";
}
