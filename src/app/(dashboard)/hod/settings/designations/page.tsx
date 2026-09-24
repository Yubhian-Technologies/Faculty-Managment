"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { DesignationCatalogCard } from "@/components/academics/DesignationCatalogCard";

export default function HodDesignationsSettingsPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Supporting Staff Designations"
        description="The job titles your department's Supporting Staff can be added under"
      />
      <DesignationCatalogCard category="TECHNICAL" />
    </div>
  );
}
