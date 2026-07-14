"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { BookOpen, ChevronRight, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Department } from "@/types";

export default function ManagementDepartmentsPage() {
  const router = useRouter();
  const { collegeId } = useParams<{ collegeId: string }>();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/management/colleges/${collegeId}/departments`)
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments(d.departments ?? []))
      .finally(() => setIsLoading(false));
  }, [collegeId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Departments"
        description="Select a department to view its HOD and faculty"
        actions={
          <Button variant="outline" onClick={() => router.push(`/management/${collegeId}`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : departments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No departments found.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((d) => (
            <Card
              key={d.id}
              className="cursor-pointer hover:border-primary transition-colors"
              onClick={() => router.push(`/management/${collegeId}/departments/${d.id}`)}
            >
              <CardContent className="p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <BookOpen className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{d.name}</p>
                    <p className="text-xs text-muted-foreground">{d.code}</p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
