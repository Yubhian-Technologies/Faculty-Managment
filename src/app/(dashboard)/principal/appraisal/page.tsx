"use client";

import { TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export default function PrincipalAppraisalPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My Appraisal" description="Performance review and appraisal" />
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <TrendingUp className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">Appraisal coming soon</p>
        </CardContent>
      </Card>
    </div>
  );
}
