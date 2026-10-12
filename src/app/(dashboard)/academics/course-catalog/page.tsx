"use client";

import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { CourseCatalogSettingsCard } from "@/components/academics/CourseCatalogSettingsCard";
import { ArrowLeft } from "lucide-react";

// Catalog-wide admin (course name/code/duration, regulation codes, intake
// batches) - not scoped to one Regulation+Course+Department, so it lives
// outside the Curriculum journey rather than as one more step in it.
export default function AcademicsCourseCatalogPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Course Catalog"
        description="Add courses and manage their regulation codes and intake batches."
        actions={
          <Button variant="outline" asChild>
            <Link href="/academics"><ArrowLeft className="h-4 w-4 mr-1" />Back to Academics</Link>
          </Button>
        }
      />
      <CourseCatalogSettingsCard showDepartments />
    </div>
  );
}
