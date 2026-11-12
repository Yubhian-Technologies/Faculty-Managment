import type { MidBankDeadline, MidBankRules, MidQuestion, MidQuestionBank, SubjectOutcomes } from "@/types";
import type { SetupIssue } from "./setup";

// Shapes the Mid Question Bank APIs return to the pages.

export interface DeadlineSummary {
  id: string; deadline: string; locked: boolean; courseName: string; year: number; semester: number; midNumber: number;
}

/** GET mid-question-banks: one card per deadline + subject + branch the faculty teaches. */
export interface MidBankListItem {
  key: string;
  deadline: DeadlineSummary;
  subject: { id: string; name: string; code: string };
  branch: string;
  sections: { sectionId: string; sectionName: string; facultyNames: string[]; mine: boolean; heldBy: string | null; bankId: string | null }[];
  myBank: { id: string; status: MidQuestionBank["status"]; approval?: MidQuestionBank["approval"] | null; reopened?: boolean; completeCount: number; totalCount: number; sections: string[]; updatedAt: string | null } | null;
  sharedBanks: { id: string; ownerName: string; sections: string[]; completeCount: number; totalCount: number }[];
  uncovered: string[];
  /** "The HOD assigns": who assigned it / who prepares it. */
  note?: string;
}

export interface PrepareSection {
  sectionId: string; sectionName: string; facultyIds: string[]; facultyNames: string[];
  mine: boolean; heldBy: string | null; heldByMe: boolean;
  /** A whole-subject paper: the section's branch. */
  branch?: string;
}

/** GET mid-question-banks/prepare. */
export interface MidBankPrepare {
  deadline: MidBankDeadline & { locked: boolean };
  subject: { id: string; name: string; code: string; courseName: string; regulation: string; year: number; semester: number; syllabusUrl?: string | null; syllabusFileName?: string | null };
  branch: string;
  outcomesId: string;
  outcomes: SubjectOutcomes | null;
  rules: MidBankRules | null;
  sections: PrepareSection[];
  setup: { issues: SetupIssue[]; units: number[] };
  myBankId: string | null;
  canEditOutcomes: boolean;
  /** Units / COs / mapping come from the subject's syllabus (HOD prepares, Academics freezes); null = an older bank's own setup. */
  syllabus?: { status: string | null; frozenAt: string | null; frozenByName: string | null; subjectDepartments: string[] } | null;
  /** "The HOD assigns": the assignment this caller prepares under (its sections are fixed - all of the scope). */
  assignment?: { scope: "BRANCH" | "GROUP" | "SUBJECT"; assignedByName: string; facultyNames: string[]; branches: string[]; sets?: number[] } | null;
  /** The college's academic tags and how it prepares Mids. */
  outcomeSwitches?: import("@/types").MidOutcomeSwitches;
  midPreparation?: import("@/types").MidPreparation;
  /** A college that prepares question papers: the Exam Cell's pattern for this subject. */
  pattern?: import("@/types").MidPaperPattern | null;
}

/** GET mid-question-banks/[id]. */
export interface MidBankDetail {
  bank: MidQuestionBank;
  deadline: MidBankDeadline | null;
  subject: { id: string; name: string; code: string; courseName: string; regulation: string; year: number; semester: number; branch: string; syllabusUrl?: string | null; syllabusFileName?: string | null };
  outcomes: SubjectOutcomes | null;
  rules: MidBankRules | null;
  questions: MidQuestion[];
  /** The header's "Branch & Sections" (short codes; a paper of several branches lists each with its sections). */
  branchLabel?: { branch: string; sections: string[] };
  access: { isOwner: boolean; isIncluded: boolean; canWrite: boolean; locked: boolean; isHod?: boolean; frozen?: boolean; reviewDepartments?: string[]; canDownload?: boolean };
}
