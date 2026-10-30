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
  myBank: { id: string; status: MidQuestionBank["status"]; approval?: MidQuestionBank["approval"] | null; completeCount: number; totalCount: number; sections: string[]; updatedAt: string | null } | null;
  sharedBanks: { id: string; ownerName: string; sections: string[]; completeCount: number; totalCount: number }[];
  uncovered: string[];
}

export interface PrepareSection {
  sectionId: string; sectionName: string; facultyIds: string[]; facultyNames: string[];
  mine: boolean; heldBy: string | null; heldByMe: boolean;
}

/** GET mid-question-banks/prepare. */
export interface MidBankPrepare {
  deadline: MidBankDeadline & { locked: boolean };
  subject: { id: string; name: string; code: string; courseName: string; regulation: string; year: number; semester: number };
  branch: string;
  outcomesId: string;
  outcomes: SubjectOutcomes | null;
  rules: MidBankRules | null;
  sections: PrepareSection[];
  setup: { issues: SetupIssue[]; units: number[] };
  myBankId: string | null;
  canEditOutcomes: boolean;
}

/** GET mid-question-banks/[id]. */
export interface MidBankDetail {
  bank: MidQuestionBank;
  deadline: MidBankDeadline | null;
  subject: { id: string; name: string; code: string; courseName: string; regulation: string; year: number; semester: number; branch: string };
  outcomes: SubjectOutcomes | null;
  rules: MidBankRules | null;
  questions: MidQuestion[];
  access: { isOwner: boolean; isIncluded: boolean; canWrite: boolean; locked: boolean; isHod?: boolean; frozen?: boolean };
}
