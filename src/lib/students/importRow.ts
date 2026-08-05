// Shared student-roster row validation/mapping, used by both the single-section
// JSON import (college/students/import) and the multi-section bulk roster
// upload (college/students/import-excel) so the roll-number/status rules and
// document shape stay in exactly one place.

import type { Section, StudentStatus } from "@/types";

export interface StudentImportRow {
  rollNumber: string;
  name: string;
  status?: string;
  gender?: string;
  dateOfBirth?: string;
  guardianContact?: string;
  email?: string;
  // View-only department (e.g. a 1st-year's registered core branch while
  // primarily enrolled under Basic Science) — only meaningfully populated by
  // the multi-department bulk import (students/import-excel); validated
  // there against real department names before reaching this helper.
  secondaryDepartment?: string;
}

export function parseStudentStatus(v: string | undefined): StudentStatus {
  return v?.trim().toUpperCase().startsWith("DET") ? "DETAINED" : "REGULAR";
}

export function buildStudentDoc(
  section: Pick<Section, "collegeId" | "department" | "name" | "year">,
  row: StudentImportRow,
  now: Date
): Record<string, unknown> {
  return {
    collegeId: section.collegeId,
    department: section.department,
    section: section.name,
    year: section.year,
    rollNumber: row.rollNumber.trim(),
    name: row.name.trim(),
    status: parseStudentStatus(row.status),
    ...(row.gender?.trim() ? { gender: row.gender.trim() } : {}),
    ...(row.dateOfBirth?.trim() ? { dateOfBirth: row.dateOfBirth.trim() } : {}),
    ...(row.guardianContact?.trim() ? { guardianContact: row.guardianContact.trim() } : {}),
    ...(row.email?.trim() ? { email: row.email.trim().toLowerCase() } : {}),
    ...(row.secondaryDepartment?.trim() ? { secondaryDepartment: row.secondaryDepartment.trim() } : {}),
    createdAt: now,
    updatedAt: now,
  };
}
