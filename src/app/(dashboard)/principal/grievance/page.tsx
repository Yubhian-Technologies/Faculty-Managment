"use client";

import { AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export default function PrincipalGrievancePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Grievance" description="Raise and track grievances" />
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <AlertCircle className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">Grievance portal coming soon</p>
        </CardContent>
      </Card>
    </div>
  );
}
