import { exportToCSV } from "@/lib/utils";

export interface AbsentRow {
  rollNumber: string;
  name: string;
  held: number;
  attend: number;
  percent: string;
}

export function exportAbsentCSV(rows: AbsentRow[], filename: string) {
  exportToCSV(rows as unknown as Record<string, unknown>[], filename, [
    { key: "rollNumber", header: "Registration No." },
    { key: "name", header: "Student Name" },
    { key: "held", header: "Held" },
    { key: "attend", header: "Attended" },
    { key: "percent", header: "%" },
  ]);
}

export interface ShortageRow extends AbsentRow {
  threshold: string;
}
export function exportShortageCSV(rows: ShortageRow[], filename: string) {
  exportToCSV(rows as unknown as Record<string, unknown>[], filename, [
    { key: "rollNumber", header: "Registration No." },
    { key: "name", header: "Student Name" },
    { key: "held", header: "Held" },
    { key: "attend", header: "Attended" },
    { key: "percent", header: "%" },
    { key: "threshold", header: "Threshold %" },
  ]);
}
