"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PiggyBank, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { College } from "@/types";

export default function ManagementBudgetDetailPage() {
  const router = useRouter();
  const { collegeId } = useParams<{ collegeId: string }>();
  const [college, setCollege] = useState<College | null>(null);

  useEffect(() => {
    fetch(`/api/management/colleges/${collegeId}`)
      .then((r) => r.json() as Promise<{ college: College }>)
      .then((d) => setCollege(d.college ?? null));
  }, [collegeId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={college?.name ?? "College"}
        description="Budget overview"
        actions={
          <Button variant="outline" onClick={() => router.push("/management/budget")}>
            <ArrowLeft className="h-4 w-4 mr-2" />All Colleges
          </Button>
        }
      />

      <Card>
        <CardContent className="p-8 flex flex-col items-center justify-center text-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
            <PiggyBank className="h-6 w-6 text-primary" />
          </div>
          <p className="font-medium">Budget details coming soon</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Budget visibility for this college is being built out. Check back soon.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
