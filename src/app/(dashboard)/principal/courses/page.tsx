"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { CourseCatalogSettingsCard } from "@/components/academics/CourseCatalogSettingsCard";

export default function CoursesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Courses"
        description="Create the courses your college offers. Departments are added under these courses from the Departments module and are listed here under each course they offer."
      />
      <CourseCatalogSettingsCard showDepartments />
    </div>
  );
}
