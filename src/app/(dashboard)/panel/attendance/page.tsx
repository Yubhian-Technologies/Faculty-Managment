"use client";

import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";

export default function FacultyAttendancePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Your monthly attendance record"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Working Days", value: "—" },
          { label: "Present", value: "—" },
          { label: "Absent", value: "—" },
          { label: "On Leave", value: "—" },
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
            title="Attendance module coming soon"
            description="View your daily attendance, monthly summary, and request corrections."
            icon={<ClipboardCheck className="h-8 w-8" />}
          />
        </CardContent>
      </Card>
    </div>
  );
}
