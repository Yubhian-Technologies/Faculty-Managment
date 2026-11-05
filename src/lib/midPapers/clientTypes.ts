// Shapes the question-paper screens read from the API (client-safe).

/** GET mid-paper-choices: one subject + branch on an exam day, its approved papers and the one chosen. */
export interface PaperChoiceRow {
  subjectId: string; subjectName: string; subjectCode: string; branch: string; branchCode: string;
  papers: { bankId: string; ownerName: string; sections: string[]; setNo: number }[];
  /** Paper sets of this subject + branch not approved yet (so the Exam Cell knows who to chase). */
  pending: { ownerName: string; stage: string }[];
  choice: { bankId: string; setNo: number; chosenByName: string; at: string } | null;
}

export interface PaperChoiceDay {
  header: { courseName: string; courseCode: string; year: number; semester: number; semesterInYear: number | null; midNumber: number; academicYear: string; date: string };
  rows: PaperChoiceRow[];
}
