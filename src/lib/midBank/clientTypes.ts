import type { MidBankRules, MidPaperAssignment, MidQuestion, MidQuestionBank, SubjectOutcomes } from "@/types";
import type { SetupIssue } from "./setup";

// Shapes the Mid Question Bank APIs return to the pages.

export interface MidBankListItem {
  id: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  midNumber: number;
  facultyName: string;
  department: string;
  courseName: string;
  year: number;
  semester: number | null;
  regulation: string;
  sections: string[];
  unitsCount: number;
  started: boolean;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE";
  units: number[];
  completeCount: number;
  totalCount: number;
  draftCount: number;
  updatedAt: string | null;
  issues: SetupIssue[];
}

export interface MidBankDetail {
  assignment: MidPaperAssignment;
  subject: {
    id: string; name: string; code: string; courseName: string; department: string;
    year: number; semester: number | null; regulation: string; academicYear: string;
  };
  sections: string[];
  outcomes: SubjectOutcomes | null;
  rules: MidBankRules | null;
  setup: { issues: SetupIssue[]; units: number[] };
  bank: MidQuestionBank | null;
  questions: MidQuestion[];
  access: { isHolder: boolean; isHod: boolean; canEditOutcomes: boolean };
}
