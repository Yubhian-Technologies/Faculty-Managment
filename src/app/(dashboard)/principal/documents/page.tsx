"use client";

import { FolderOpen } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export default function PrincipalDocumentsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="College Documents"
        description="Official college documents, circulars, and policy files"
      />
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <FolderOpen className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">Document management coming soon</p>
          <p className="text-xs text-muted-foreground">Manage institution-level documents accessible to all staff</p>
        </CardContent>
      </Card>
    </div>
  );
}
