"use client";

import { CollegesListView } from "@/components/management/CollegesListView";

export default function ManagementFacultyCollegesPage() {
  return (
    <CollegesListView
      title="Faculty Details"
      description="Select a college to view its institutional profile"
      basePath="/management/faculty"
    />
  );
}
