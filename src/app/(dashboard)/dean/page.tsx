"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { useAuthStore } from "@/store/authStore";
import { ROLE_LABELS } from "@/types";
import { RegulationSettingsCard } from "@/components/settings/RegulationSettingsCard";
import { CourseCatalogSettingsCard } from "@/components/academics/CourseCatalogSettingsCard";

export default function DeanDashboard() {
  const user = useAuthStore((s) => s.user);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user?.name ?? "there"}`}
        description={ROLE_LABELS.DEAN}
      />
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Your account was created by the Principal. Access to specific modules is granted by your
          college&apos;s administration as needed.
        </CardContent>
      </Card>

      {/* Read-only - the Principal maintains these under Settings; whatever
          they save there shows up here immediately on next load. Academic
          Regulations is the college-wide declared list of regulation codes;
          Course Catalog below shows each course's own subset of those codes
          (and which of its years each applies to) - same order as the
          Principal's own Settings page, since Regulations is the prerequisite. */}
      <RegulationSettingsCard readOnly />
      <CourseCatalogSettingsCard readOnly />
    </div>
  );
}
