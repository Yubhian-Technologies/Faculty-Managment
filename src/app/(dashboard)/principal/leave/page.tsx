"use client";

import { CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export default function PrincipalLeavePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My Leave" description="Apply and track your leave requests" />
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <CalendarClock className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">Leave management coming soon</p>
        </CardContent>
      </Card>
    </div>
  );
}
