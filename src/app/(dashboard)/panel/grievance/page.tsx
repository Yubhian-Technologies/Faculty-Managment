"use client";

import { AlertCircle, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";

export default function GrievancePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Grievance"
        description="Raise and track workplace grievances"
        actions={
          <Button disabled>
            <Plus className="h-4 w-4 mr-2" />
            Raise Grievance
          </Button>
        }
      />

      <Card>
        <CardContent className="p-6">
          <EmptyState
            title="Grievance module coming soon"
            description="Raise grievances related to salary, workload, infrastructure, harassment or administrative issues. Anonymous filing is supported. Track resolution status."
            icon={<AlertCircle className="h-8 w-8" />}
          />
        </CardContent>
      </Card>
    </div>
  );
}
