// Bulk-import template for Dean > Subjects > Import. One row = one subject.
// Department/Course/Academic Year/Year are per-row columns (like the student
// roster importer's Department/Course/Year - src/lib/students/rosterFields.ts)
// so a single file is self-contained and can be filled in and uploaded without
// any on-page picker first. When reached via a specific course-year's own
// "Import Subjects" shortcut (see dean/subjects/page.tsx), these 4 columns are
// instead locked to that context and hidden from the template/preview - see
// LOCKED_KEYS in dean/subjects/import/page.tsx.
export type SubjectCsvColumn = {
  key: string;
  label: string;
  required: boolean;
  sample: string;
  aliases?: string[];
};

export const IMPORT_COLUMNS: SubjectCsvColumn[] = [
  { key: "department", label: "Department", required: true, sample: "Computer Science Engineering", aliases: ["Branch", "Dept"] },
  { key: "course", label: "Course", required: true, sample: "Bachelor of Technology", aliases: ["Programme", "Program"] },
  { key: "academicYear", label: "Academic Year", required: true, sample: "2026-27", aliases: ["Session", "Academic Session"] },
  { key: "year", label: "Year", required: true, sample: "2", aliases: ["Course Year", "Ordinal Year"] },
  { key: "serialNumber", label: "S.No.", required: true, sample: "1", aliases: ["Serial Number", "Sl No", "S No"] },
  { key: "category", label: "Category", required: true, sample: "PCC", aliases: ["Subject Category"] },
  { key: "customCategory", label: "Custom Category (if Other)", required: false, sample: "", aliases: ["Other Category"] },
  { key: "name", label: "Name of the Subject", required: true, sample: "Data Structures", aliases: ["Subject Name", "Subject"] },
  { key: "code", label: "Code", required: true, sample: "CS201", aliases: ["Subject Code"] },
  { key: "regulation", label: "Regulation", required: false, sample: "", aliases: ["Regulation Code"] },
  { key: "type", label: "Type", required: false, sample: "Theory", aliases: ["Subject Type"] },
  { key: "lectureHours", label: "L", required: true, sample: "3", aliases: ["Lecture Hours", "Lecture"] },
  { key: "tutorialHours", label: "T", required: true, sample: "0", aliases: ["Tutorial Hours", "Tutorial"] },
  { key: "practicalHours", label: "P", required: true, sample: "0", aliases: ["Practical Hours", "Practical"] },
  { key: "hoursPerWeek", label: "Hours / Week", required: false, sample: "3", aliases: ["Hours Per Week", "Weekly Hours"] },
  { key: "totalHoursPerSemester", label: "Hours / Semester", required: false, sample: "", aliases: ["Hours Per Semester", "Total Hours"] },
  { key: "credits", label: "Credits", required: false, sample: "3", aliases: ["Credit"] },
];

export const IMPORT_HINTS = [
  "Department accepts either the full name (e.g. \"Computer Science Engineering\") or the short Code - a \"Branch\" column is read the same way.",
  "Course is the programme (e.g. \"Bachelor of Technology\") and must be one the row's Department actually offers, or the row is skipped.",
  "Academic Year is the calendar session this subject is offered in (e.g. \"2026-27\"). Year is the ordinal year of the course (1, 2, 3...).",
  "A single file may mix multiple departments, courses and years - each row resolves its own.",
  "Category: HSMC, BSC, ESC, PCC, PEC, OEC, MC, PROJ, or Other - either the short code (e.g. \"PCC\") or the full name (e.g. \"Professional Core\") is accepted",
  "Custom Category is required only when Category is \"Other\"",
  "Type: Theory, Practical, Tutorial, or Project - defaults to Theory if left blank",
  "Regulation must match what this Department/Course/Year/Academic Year actually resolves to under Course Catalog's batch assignments - leave it blank to use it automatically when unambiguous, or the row is rejected if it doesn't match.",
  "L, T and P (weekly Lecture/Tutorial/Practical hours) are required for every row",
  "Hours / Week, Hours / Semester and Credits are optional and default to 0 if left blank",
];
