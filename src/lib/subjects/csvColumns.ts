// Bulk-import template for Academics > Course Structure. Row rules live in
// courseStructureValidation.ts (shared by the page and the server). One row = one subject,
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
  { key: "code", label: "Subject Code", required: false, sample: "CS201", aliases: ["Code", "Course Code", "Paper Code"] },
  { key: "lectureHours", label: "L", required: true, sample: "3", aliases: ["Lecture Hours", "Lecture"] },
  { key: "tutorialHours", label: "T", required: true, sample: "0", aliases: ["Tutorial Hours", "Tutorial"] },
  { key: "practicalHours", label: "P", required: true, sample: "0", aliases: ["Practical Hours", "Practical"] },
  { key: "internalMarks", label: "Internal Marks", required: false, sample: "30", aliases: ["Internal", "Internal Max Marks"] },
  { key: "externalMarks", label: "External Marks", required: false, sample: "70", aliases: ["External", "External Max Marks"] },
  { key: "totalMarks", label: "Total Marks", required: false, sample: "100", aliases: ["Total", "Total Max Marks"] },
  { key: "credits", label: "Credits", required: false, sample: "3", aliases: ["Credit", "Credits"] },
  { key: "shortCode", label: "Short Code", required: false, sample: "DS", aliases: ["Short Name", "Abbreviation", "Display Code"] },
  { key: "hoursPerWeek", label: "Weekly Hours", required: false, sample: "3", aliases: ["Hours Per Week", "Hours / Week"] },
  { key: "type", label: "Type", required: false, sample: "Theory", aliases: ["Subject Type"] },
  { key: "customCategory", label: "Custom Category", required: false, sample: "", aliases: ["Other Category"] },
];

export const IMPORT_HINTS = [
  "Regulation, Course and Department are chosen above - every row is created under that regulation and assigned to that department.",
  "Year and Semester are required per row and must be one of the years/semesters listed for this department above. \"2\", \"II\" and \"Year 2\" are all read as Year 2.",
  "The whole file is imported together or not at all: if any row has a problem, nothing is saved until the file is fixed.",
  "Category: HSMC, BSC, ESC, PCC, PEC, OEC, MC, PROJ or Other (short code or full name). Other needs a Custom Category.",
  "L, T and P (weekly Lecture/Tutorial/Practical hours) are required - use 0 where there are none.",
  "Subject Code is optional but recommended (e.g. the university's paper code). Without it, a code is made from the name, and two names that start the same way will clash.",
  "A subject that already exists for this course and regulation (same code, name, category and L-T-P) is linked, not duplicated. The same subject may appear in two semesters.",
  "Type (Theory / Practical / Tutorial / Project) is optional - left blank, a subject with only P hours is treated as Practical.",
  "Credits, Weekly Hours, Short Code and the Marks columns are optional. Credits default to L+T+0.5P; Internal + External must equal Total when all three are given.",
];
