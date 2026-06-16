"use client";

import { BookOpen } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";

export default function TeachingLoadPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Teaching Load"
        description="Assigned subjects and timetable for current semester"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: "Subjects", value: "—" },
          { label: "Hours / Week", value: "—" },
          { label: "Total Credits", value: "—" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-bold mt-1">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-6">
          <EmptyState
            title="Teaching module coming soon"
            description="View your assigned subjects, timetable slots, and weekly teaching hours."
            icon={<BookOpen className="h-8 w-8" />}
          />
        </CardContent>
      </Card>
    </div>
  );
}
