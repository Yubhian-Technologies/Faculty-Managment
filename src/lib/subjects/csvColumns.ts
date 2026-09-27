// Bulk-import template for Academics > Subjects > Import. One row = one subject.
// Course and Regulation are selected once via the page filters (not repeated per row).
// Department and Year are assigned later via "Assign to Semester", not during master subject import.
export type SubjectCsvColumn = {
  key: string;
  label: string;
  required: boolean;
  sample: string;
  aliases?: string[];
};

export const IMPORT_COLUMNS: SubjectCsvColumn[] = [
  { key: "serialNumber", label: "S.No.", required: true, sample: "1", aliases: ["Serial Number", "Sl No", "S No", "Position"] },
  { key: "category", label: "Category", required: true, sample: "PCC", aliases: ["Subject Category"] },
  { key: "customCategory", label: "Custom Category (if Other)", required: false, sample: "", aliases: ["Other Category"] },
  { key: "name", label: "Name of the Subject", required: true, sample: "Data Structures", aliases: ["Subject Name", "Subject", "Course Title"] },
  { key: "code", label: "Code", required: true, sample: "CS201", aliases: ["Subject Code", "Course Code"] },
  { key: "shortCode", label: "Short Code", required: false, sample: "DS", aliases: ["Short Name", "Abbreviation", "Display Code"] },
  { key: "type", label: "Type", required: false, sample: "Theory", aliases: ["Subject Type"] },
  { key: "lectureHours", label: "L", required: true, sample: "3", aliases: ["Lecture Hours", "Lecture"] },
  { key: "tutorialHours", label: "T", required: true, sample: "0", aliases: ["Tutorial Hours", "Tutorial"] },
  { key: "practicalHours", label: "P", required: true, sample: "0", aliases: ["Practical Hours", "Practical"] },
  { key: "hoursPerWeek", label: "Hours / Week", required: false, sample: "3", aliases: ["Hours Per Week", "Weekly Hours"] },
  { key: "totalHoursPerSemester", label: "Hours / Semester", required: false, sample: "", aliases: ["Hours Per Semester", "Total Hours"] },
  { key: "credits", label: "Credits", required: false, sample: "3", aliases: ["Credit", "Credits"] },
];

export const IMPORT_HINTS = [
  "Course and Regulation are selected in the page filters at the top — all subjects in the template will be imported for that course and regulation.",
  "Short Code is a compact display name shown in the timetable and other tight spaces (e.g. \"CHE\" for Chemistry) — optional, but recommended for every subject.",
  "Category: HSMC, BSC, ESC, PCC, PEC, OEC, MC, PROJ, or Other — either the short code (e.g. \"PCC\") or the full name (e.g. \"Professional Core\") is accepted.",
  "Custom Category is required only when Category is \"Other\".",
  "Type: Theory, Practical, Tutorial, or Project — defaults to Theory if left blank.",
  "L, T and P (weekly Lecture/Tutorial/Practical hours) are required for every row.",
  "Hours / Week, Hours / Semester and Credits are optional and default to 0 if left blank.",
];
