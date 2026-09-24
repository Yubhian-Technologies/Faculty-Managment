"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { CourseCatalogSettingsCard } from "@/components/academics/CourseCatalogSettingsCard";

export default function CoursesPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Courses" />
      <CourseCatalogSettingsCard showDepartments />
    </div>
  );
}
