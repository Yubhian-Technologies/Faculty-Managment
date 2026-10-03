"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { NavLayoutBuilder } from "@/components/customNav/NavLayoutBuilder";

export default function CustomizeDashboardsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Customise Dashboards"
        description="Per college and role: number and reorder sidebar tabs, switch tabs on or off, and add your own tabs with custom pages."
      />
      <NavLayoutBuilder />
    </div>
  );
}
