// Bulk-import template for the Academics "Import Subjects" action - Course
// and Regulation are picked once via the Subjects step's own scope bar, not
// repeated per row. Unlike Course Structure's own template
// (csvColumns.ts), there's no Year/Semester column here - rows land in the
// master Subjects collection only; assigning them to a department/year/
// semester stays a separate step (Assign to Semester).
export type MasterSubjectCsvColumn = {
  key: string;
  label: string;
  required: boolean;
  sample: string;
  aliases?: string[];
};

export const MASTER_IMPORT_COLUMNS: MasterSubjectCsvColumn[] = [
  { key: "serialNumber", label: "S.No.", required: true, sample: "1", aliases: ["SNo", "Sl No", "Serial Number"] },
  { key: "category", label: "Category", required: true, sample: "PCC", aliases: ["Subject Category"] },
  { key: "name", label: "Subject Name", required: true, sample: "Data Structures", aliases: ["Name of the Subject", "Subject", "Course Title"] },
  { key: "code", label: "Subject Code", required: true, sample: "CS201", aliases: ["Code", "Course Code", "Paper Code"] },
  { key: "lectureHours", label: "L", required: true, sample: "3", aliases: ["Lecture Hours", "Lecture"] },
  { key: "tutorialHours", label: "T", required: true, sample: "0", aliases: ["Tutorial Hours", "Tutorial"] },
  { key: "practicalHours", label: "P", required: true, sample: "0", aliases: ["Practical Hours", "Practical"] },
  { key: "credits", label: "Credits", required: false, sample: "3", aliases: ["Credit", "Credits"] },
  { key: "shortCode", label: "Short Code", required: false, sample: "DS", aliases: ["Short Name", "Abbreviation", "Display Code"] },
  { key: "type", label: "Type", required: false, sample: "Theory", aliases: ["Subject Type"] },
  { key: "customCategory", label: "Custom Category", required: false, sample: "", aliases: ["Other Category"] },
  { key: "internalMarks", label: "Internal Marks", required: false, sample: "30", aliases: ["Internal", "Internal Max Marks"] },
  { key: "externalMarks", label: "External Marks", required: false, sample: "70", aliases: ["External", "External Max Marks"] },
  { key: "totalMarks", label: "Total Marks", required: false, sample: "100", aliases: ["Total", "Total Max Marks"] },
];

export const MASTER_IMPORT_HINTS = [
  "Each row is one subject, saved under the Course and Regulation selected above - no department, year or semester here. Assign it to a department's semester afterwards from this same page.",
  "S.No., Category, Subject Name, Subject Code, L, T and P are required. Enter 0 for an hours column with none.",
  "Category must be a standard category (HSMC, BSC, ESC, PCC, PEC, OEC, MC, PROJ) or one defined under Academics > Categories.",
  "If a subject with the same code already exists for this course and regulation (under any department teaching it), that row is skipped and reported - it's not duplicated.",
  "Rows with a problem are skipped and reported; every other valid row still imports.",
];
