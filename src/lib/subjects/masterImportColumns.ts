// Bulk-import template for Academics > Curriculum > Subjects - Course and
// Regulation are picked once in the scope bar, not repeated per row. There is
// no Department / Year / Semester column: rows land in the course + regulation
// master only. Assigning them to a department's semester is the separate
// "Assign by code" step.
export type MasterSubjectCsvColumn = {
  key: string;
  label: string;
  required: boolean;
  sample: string;
  aliases?: string[];
};

export const MASTER_IMPORT_COLUMNS: MasterSubjectCsvColumn[] = [
  { key: "category", label: "Category", required: true, sample: "PCC", aliases: ["Subject Category"] },
  { key: "name", label: "Subject Name", required: true, sample: "Data Structures", aliases: ["Name of the Subject", "Subject", "Course Title"] },
  { key: "code", label: "Subject Code", required: true, sample: "CS201", aliases: ["Code", "Course Code", "Paper Code"] },
  { key: "lectureHours", label: "L", required: true, sample: "3", aliases: ["Lecture Hours", "Lecture"] },
  { key: "tutorialHours", label: "T", required: true, sample: "0", aliases: ["Tutorial Hours", "Tutorial"] },
  { key: "practicalHours", label: "P", required: true, sample: "0", aliases: ["Practical Hours", "Practical"] },
  { key: "credits", label: "Credits", required: true, sample: "3", aliases: ["Credit", "Credits"] },
  { key: "shortCode", label: "Short Code", required: false, sample: "DS", aliases: ["Short Name", "Abbreviation", "Display Code"] },
  { key: "type", label: "Type", required: false, sample: "Theory", aliases: ["Subject Type"] },
  { key: "customCategory", label: "Custom Category", required: false, sample: "", aliases: ["Other Category"] },
  { key: "internalMarks", label: "Internal Marks", required: false, sample: "30", aliases: ["Internal", "Internal Max Marks"] },
  { key: "externalMarks", label: "External Marks", required: false, sample: "70", aliases: ["External", "External Max Marks"] },
  { key: "totalMarks", label: "Total Marks", required: false, sample: "100", aliases: ["Total", "Total Max Marks"] },
];

export const MASTER_IMPORT_HINTS = [
  "Each row is one subject, saved under the Course and Regulation selected above - no department, year or semester here. Assign it to a department's semester afterwards with Assign by code.",
  "Category, Subject Name, Subject Code, L, T, P and Credits are required. Enter 0 (or -) where there are none; use 0 for a zero-credit course. Nothing is filled in for you.",
  "Subject Code and Subject Name must each be unique within the course and regulation. A row that repeats either one - in the file or against a subject already saved - stops the import.",
  "Category must be a standard category (HSMC, BSC, ESC, PCC, PEC, OEC, MC, PROJ) or one defined under Academics > Categories.",
  "If any row has a problem, nothing is imported. Fix the file and upload it again.",
];
