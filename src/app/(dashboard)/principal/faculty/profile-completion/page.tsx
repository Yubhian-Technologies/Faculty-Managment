"use client";

import { FacultyProfileCompletionView } from "@/components/faculty/FacultyProfileCompletionView";

// Shared route for Principal and Vice Principal (same as /principal/faculty)
// - department filter + Load, or All Departments.
export default function PrincipalFacultyProfileCompletionPage() {
  return <FacultyProfileCompletionView role="PRINCIPAL" />;
}
