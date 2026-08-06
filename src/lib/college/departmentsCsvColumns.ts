// Shared department CSV column definitions - used by the bulk-import template
// and upload page (src/app/(dashboard)/principal/departments/import/page.tsx).

export interface DepartmentCsvColumn {
  key: string;
  label: string;
  required: boolean;
  sample: string;
  // Alternate header wordings that should still map to this column (see matchHeaders in csv.ts).
  aliases?: string[];
}

export const COLUMNS: DepartmentCsvColumn[] = [
  { key: "name", label: "Department Name", required: true, sample: "Computer Science", aliases: ["Department", "Dept Name", "Department Name"] },
  { key: "code", label: "Short Code", required: true, sample: "CS", aliases: ["Code", "Dept Code", "Department Code"] },
  { key: "hodEmail", label: "HOD Email", required: false, sample: "hod.cs@vishnu.edu.in", aliases: ["HOD Email ID", "Head of Department Email", "HOD"] },
];

export const HINTS = [
  "Short Code: 2-10 uppercase letters, used in reports and batch IDs",
  "HOD Email must match an existing HOD account's login email - create the HOD first (via \"+ Create HOD\" on the Add Department page) if they don't have one yet",
  "Leave HOD Email blank to add the department without an HOD; assign one later from the Departments page",
];
