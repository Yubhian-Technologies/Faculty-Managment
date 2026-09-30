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
  "Each row is one subject. Every row is saved under the regulation, course and department selected above.",
  "Year and Semester are required. Use only the years listed above for this department. 2, II and Year 2 are all read as Year 2. For Semester, use the semester numbers listed for the year (for example 5 or 6), or 1 and 2 for the year's first and second semester.",
  "If any row has a problem, nothing is imported. Fix the file and upload it again.",
  "Category is required. Use a standard category (HSMC, BSC, ESC, PCC, PEC, OEC, MC, PROJ) or one defined under Academics, Categories, by its short code or full form. A category that isn't defined stops the import.",
  "L, T and P are the weekly lecture, tutorial and practical hours. They are required. Enter 0 (or -) where there are none.",
  "Subject Code is optional. If it's blank, a code is made from the subject name, so two names that start the same way will clash. Use the university paper code where you have one.",
  "If a subject with the same code, name, category and L-T-P already exists for this course and regulation, it is reused. A subject can appear in more than one semester.",
  "Type is optional: Theory, Practical, Tutorial or Project. If it's blank, a subject with only P hours is treated as Practical.",
  "Credits, Weekly Hours, Short Code and the marks columns are optional. Credits default to L + T + half of P. Use 0, - or NC for a course with no credits. If you fill in all three marks columns, Internal + External must equal Total.",
];
