// Bulk-import template for Academics > Course Structure. One row = one subject,
// auto-created as a master Subject AND auto-assigned to the selected
// department's semester (see CourseStructureImportService) - Course,
// Regulation and Department are all selected once via the page's own
// picker, not repeated per row; Year/Semester ARE per row here (unlike the
// old course+regulation-only import this replaced) since that's what drives
// the auto-assignment.
export type SubjectCsvColumn = {
  key: string;
  label: string;
  required: boolean;
  sample: string;
  aliases?: string[];
};

export const IMPORT_COLUMNS: SubjectCsvColumn[] = [
  { key: "year", label: "Year", required: true, sample: "2", aliases: ["Academic Year", "Study Year"] },
  { key: "semester", label: "Semester", required: true, sample: "1", aliases: ["Sem"] },
  { key: "category", label: "Category", required: true, sample: "PCC", aliases: ["Subject Category"] },
  { key: "name", label: "Subject Name", required: true, sample: "Data Structures", aliases: ["Name of the Subject", "Subject", "Course Title"] },
  { key: "lectureHours", label: "L", required: true, sample: "3", aliases: ["Lecture Hours", "Lecture"] },
  { key: "tutorialHours", label: "T", required: true, sample: "0", aliases: ["Tutorial Hours", "Tutorial"] },
  { key: "practicalHours", label: "P", required: true, sample: "0", aliases: ["Practical Hours", "Practical"] },
  { key: "internalMarks", label: "Internal Marks", required: false, sample: "30", aliases: ["Internal", "Internal Max Marks"] },
  { key: "externalMarks", label: "External Marks", required: false, sample: "70", aliases: ["External", "External Max Marks"] },
  { key: "totalMarks", label: "Total Marks", required: false, sample: "100", aliases: ["Total", "Total Max Marks"] },
  { key: "credits", label: "Credits", required: false, sample: "3", aliases: ["Credit", "Credits"] },
  { key: "shortCode", label: "Short Code", required: false, sample: "DS", aliases: ["Short Name", "Abbreviation", "Display Code"] },
  { key: "hoursPerWeek", label: "Weekly Hours", required: false, sample: "3", aliases: ["Hours Per Week", "Hours / Week"] },
];

export const IMPORT_HINTS = [
  "Course, Regulation and Department are selected in the page filters at the top — every row is imported and assigned for that course/regulation/department.",
  "Year and Semester are required per row — this is what routes each subject into the correct department semester automatically, without a separate Assign to Semester step.",
  "Category: HSMC, BSC, ESC, PCC, PEC, OEC, MC, PROJ, or Other — either the short code (e.g. \"PCC\") or the full name (e.g. \"Professional Core\") is accepted.",
  "L, T and P (weekly Lecture/Tutorial/Practical hours) are required for every row.",
  "Internal Marks, External Marks and Total Marks are reference-only — they're stored on the subject but don't configure the actual Exam Cell marks setup.",
  "Short Code is a compact display name shown in the timetable and other tight spaces (e.g. \"CHE\" for Chemistry) — optional, but recommended for every subject.",
  "Credits and Weekly Hours are optional — Weekly Hours defaults to L+T+P, and Credits defaults to L+T+0.5P if left blank.",
];
