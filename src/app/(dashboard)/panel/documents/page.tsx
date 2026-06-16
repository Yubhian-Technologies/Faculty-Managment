"use client";

import { FolderOpen, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";

export default function FacultyDocumentsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="My Documents"
        description="Upload and manage your qualification, experience and other documents"
        actions={
          <Button disabled>
            <Plus className="h-4 w-4 mr-2" />
            Upload Document
          </Button>
        }
      />

      <Card>
        <CardContent className="p-6">
          <EmptyState
            title="Documents module coming soon"
            description="Upload identity documents, educational qualifications, experience certificates, and other professional documents. Admins can verify uploaded documents."
            icon={<FolderOpen className="h-8 w-8" />}
          />
        </CardContent>
      </Card>
    </div>
  );
}
