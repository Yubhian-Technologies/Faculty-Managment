"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { RegulationSettingsCard } from "@/components/settings/RegulationSettingsCard";

// The same card the Principal edits on their own Settings page, fully editable
// here - an HOD maintains their department's curriculum, so the regulation
// codes and the intake batches each one covers need to be theirs to keep
// current rather than a request to the Principal.
//
// Deliberately the same component rather than a department-scoped copy: the
// underlying AcademicRegulationSettings is one college-wide record, so there
// is nothing per-department to render differently, and a second copy would
// only drift from the Principal's.
export default function HodRegulationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Regulations & Batches"
        description="Curriculum regulation codes and the intake batches each one covers - shared across the whole college"
      />
      <RegulationSettingsCard />
    </div>
  );
}
