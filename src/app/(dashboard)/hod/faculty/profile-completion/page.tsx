"use client";

import { FacultyProfileCompletionView } from "@/components/faculty/FacultyProfileCompletionView";

// The HOD's own department tree only - the API scopes it the same way
// GET /api/college/faculty does for the Faculty Register.
export default function HodFacultyProfileCompletionPage() {
  return <FacultyProfileCompletionView role="HOD" />;
}
