import type { BloomLevel, MidQuestionFormat, MidQuestionPart } from "@/types";
import type { PaperSlot } from "./rules";

// What the Mid question paper generator returns for one exam date: per subject
// on that date (per branch, per question bank) everything needed to show,
// swap, regenerate and print the paper in the browser. Nothing is stored.

export interface PaperQuestion { id: string; unit: number; slot: number; format?: MidQuestionFormat; parts: MidQuestionPart[] }

export interface GeneratedPaper {
  key: string;
  branch: string;
  branchCode: string;
  subjectName: string;
  subjectCode: string;
  regulation: string;
  sections: string[];
  ownerName: string;
  /** Why no paper could be made for this subject (bank missing / not complete / short of questions). */
  error?: string;
  shortages?: string[];
  slots: PaperSlot[];
  /** The 6 picked question ids, in slot order. */
  picked: string[];
  /** Every question that could fill each slot (for Swap / Regenerate). */
  candidates: Record<number, string[]>;
  questions: Record<string, PaperQuestion>;
  unitTitles: Record<string, string>;
  cos: { id: string; statement: string }[];
  mapping: Record<string, string[]>;
  marks: number;
  maxMarks: number;
  instruction: string;
  regdBoxes: number;
  /** Exam length of this paper's own session (branches may write at different times). */
  minutes?: number | null;
  startLevel: BloomLevel;
}

export interface GeneratedPapers {
  header: { courseName: string; courseCode: string; year: number; semesterInYear: number | null; semester: number; midNumber: number; academicYear: string; date: string; minutes: number | null; sessionLabel: string };
  papers: GeneratedPaper[];
}
