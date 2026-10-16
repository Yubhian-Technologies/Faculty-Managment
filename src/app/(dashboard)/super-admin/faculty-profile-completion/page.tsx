"use client";

import { FacultyProfileCompletionView } from "@/components/faculty/FacultyProfileCompletionView";

// Super Admin has no ambient college - college picker + department filter +
// Load, same shape as /super-admin/audit-logs.
export default function SuperAdminFacultyProfileCompletionPage() {
  return <FacultyProfileCompletionView role="SUPER_ADMIN" />;
}
