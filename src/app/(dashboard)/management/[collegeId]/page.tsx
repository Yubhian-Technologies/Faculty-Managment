"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { UserCog, Users2, ChevronRight, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { College } from "@/types";

export default function ManagementCollegeDetailPage() {
  const router = useRouter();
  const { collegeId } = useParams<{ collegeId: string }>();
  const [college, setCollege] = useState<College | null>(null);

  useEffect(() => {
    fetch("/api/management/colleges")
      .then((r) => r.json() as Promise<{ colleges: College[] }>)
      .then((d) => setCollege((d.colleges ?? []).find((c) => c.id === collegeId) ?? null));
  }, [collegeId]);

  const cards = [
    { label: "Principal", icon: UserCog, href: `/management/${collegeId}/principal` },
    { label: "Vice Principal", icon: UserCog, href: `/management/${collegeId}/vice-principal` },
    { label: "Departments", icon: Users2, href: `/management/${collegeId}/departments` },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={college?.name ?? "College"}
        description="Institutional overview"
        actions={
          <Button variant="outline" onClick={() => router.push("/management")}>
            <ArrowLeft className="h-4 w-4 mr-2" />All Colleges
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
