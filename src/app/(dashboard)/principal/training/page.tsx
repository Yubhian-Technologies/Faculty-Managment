"use client";

import { GraduationCap } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export default function PrincipalTrainingPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Training" description="FDPs, workshops, and professional development" />
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <GraduationCap className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">Training records coming soon</p>
        </CardContent>
      </Card>
    </div>
  );
}
