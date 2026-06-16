"use client";

import { GraduationCap } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export default function PrincipalTrainingPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Training Approvals"
        description="Approve FDP, workshop, and professional development requests"
      />
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <GraduationCap className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">Training approval queue coming soon</p>
          <p className="text-xs text-muted-foreground">Faculty and HOD training requests submitted through their portals appear here for sanctioning</p>
        </CardContent>
      </Card>
    </div>
  );
}
