"use client";

import { GraduationCap } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";

export default function TrainingPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Training & Development"
        description="FDPs, workshops, certifications and seminars"
      />

      <Card>
        <CardContent className="p-6">
          <EmptyState
            title="Training module coming soon"
            description="Browse and enroll in Faculty Development Programmes, workshops, conferences and certification courses. Track your certificates and training history."
            icon={<GraduationCap className="h-8 w-8" />}
          />
        </CardContent>
      </Card>
    </div>
  );
}
