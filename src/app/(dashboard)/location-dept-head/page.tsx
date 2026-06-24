"use client";

import Link from "next/link";
import { Users, ClipboardPlus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";

export default function LocationDeptHeadDashboard() {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name?.split(" ")[0] ?? "Dept Head"}`}
        description={`${user?.department ?? "Location"} Department Head`}
      />
      <div className="grid gap-4 sm:grid-cols-2 max-w-lg">
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-5 flex items-start gap-4">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <ClipboardPlus className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm">Vacancy Requests</p>
              <p className="text-xs text-muted-foreground mt-0.5">Request faculty positions for your department</p>
              <Button asChild size="sm" variant="outline" className="mt-3">
                <Link href="/location-dept-head/vacancies">View Requests</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-5 flex items-start gap-4">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm">Candidates</p>
              <p className="text-xs text-muted-foreground mt-0.5">View and interview faculty candidates</p>
              <Button asChild size="sm" variant="outline" className="mt-3">
                <Link href="/location-dept-head/candidates">View Candidates</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
