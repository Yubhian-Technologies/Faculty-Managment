import type { Timestamp } from "firebase/firestore";
import type { BloomLevel } from "./midQuestionBank";

// Mid Question Paper template - Exam Cell > Mid Configuration > Question paper,
// per course + regulation (or "ALL"), like the question bank rules:
//
//   colleges/{c}/midPaperTemplates/{courseKey}__{regulation|ALL}
//
// A paper is 6 questions in 3 OR-pairs (1 OR 2, 3 OR 4, 5 OR 6). Papers are
// generated on demand and downloaded - never stored.

export interface MidPaperTemplate {
  id: string;
  courseKey: string;
  courseName: string;
  regulation: string;
  /** For each level Question 1 may start at, the levels of Questions 1-6 (every part of a question has its level). */
  sequences: Record<BloomLevel, BloomLevel[]>;
  /** For a Mid covering N units ("2", "3" ...), the unit (1..N, position in the Mid) of Questions 1-6. */
  units: Record<string, number[]>;
  instruction: string;
  /** Printed max marks; absent = 3 x the bank's marks per question. */
  maxMarks?: number | null;
  updatedBy: string;
  updatedByName: string;
  updatedAt: Timestamp;
}
