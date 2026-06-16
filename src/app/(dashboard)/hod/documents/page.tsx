"use client";

import { FolderOpen } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";

export default function HODDocumentsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My Documents" description="Official documents, certificates and letters" />
      <Card><CardContent className="p-8"><EmptyState title="Documents module coming soon" description="Experience certificates, appointment letters and other official documents will be available here." icon={<FolderOpen className="h-8 w-8" />} /></CardContent></Card>
    </div>
  );
}
