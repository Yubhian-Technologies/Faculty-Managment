"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { UserCog, UsersRound, ChevronRight, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Department } from "@/types";

export default function ManagementDepartmentDetailPage() {
  const router = useRouter();
  const { collegeId, deptId } = useParams<{ collegeId: string; deptId: string }>();
  const [department, setDepartment] = useState<Department | null>(null);

  useEffect(() => {
    fetch(`/api/management/colleges/${collegeId}/departments`)
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartment((d.departments ?? []).find((x) => x.id === deptId) ?? null));
  }, [collegeId, deptId]);

  const base = `/management/${collegeId}/departments/${deptId}`;
  const cards = [
    { label: "HOD", icon: UserCog, href: `${base}/hod` },
    { label: "Faculty", icon: UsersRound, href: `${base}/faculty` },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={department?.name ?? "Department"}
        description={department?.code}
        actions={
          <Button variant="outline" onClick={() => router.push(`/management/${collegeId}/departments`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Card key={c.label} className="cursor-pointer hover:border-primary transition-colors" onClick={() => router.push(c.href)}>
            <CardContent className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <c.icon className="h-5 w-5 text-primary" />
                </div>
                <p className="font-medium">{c.label}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
