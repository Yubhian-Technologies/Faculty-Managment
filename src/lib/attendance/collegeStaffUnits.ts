import { ROLE_LABELS, type UserRole } from "@/types/core";

// College Office and Exam Cell each oversee a set of COLLEGE_STAFF members -
// no new roles for this (their staff already share the one existing
// COLLEGE_STAFF role used college-wide). The link between a COLLEGE_STAFF
// login and which of the two units they belong to is the existing
// `department` field on their users/{uid} doc, set to the exact unit label
// below (reused from ROLE_LABELS so it can never drift from the head role's
// own display name).
export const COLLEGE_STAFF_UNIT_HEAD_ROLES: UserRole[] = ["COLLEGE_OFFICE", "EXAM_CELL"];

export const UNIT_LABEL_BY_HEAD_ROLE: Partial<Record<UserRole, string>> = {
  COLLEGE_OFFICE: ROLE_LABELS.COLLEGE_OFFICE,
  EXAM_CELL: ROLE_LABELS.EXAM_CELL,
};

export function unitLabelForHeadRole(role: string): string | undefined {
  return UNIT_LABEL_BY_HEAD_ROLE[role as UserRole];
}

export function isCollegeStaffUnitHead(role: string): boolean {
  return COLLEGE_STAFF_UNIT_HEAD_ROLES.includes(role as UserRole);
}
