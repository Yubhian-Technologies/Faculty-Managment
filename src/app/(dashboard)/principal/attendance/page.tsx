"use client";

import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export default function PrincipalAttendancePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My Attendance" description="View your attendance records" />
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <ClipboardCheck className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">Attendance records coming soon</p>
        </CardContent>
      </Card>
    </div>
  );
}
