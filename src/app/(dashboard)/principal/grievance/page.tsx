"use client";

import { AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export default function PrincipalGrievancePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Grievance Desk"
        description="Review and resolve escalated grievances from faculty and HODs"
      />
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <AlertCircle className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">Grievance management coming soon</p>
          <p className="text-xs text-muted-foreground">Grievances raised by faculty that are escalated beyond the HOD level appear here</p>
        </CardContent>
      </Card>
    </div>
  );
}
