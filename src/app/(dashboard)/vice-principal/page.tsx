"use client";

import Link from "next/link";
import { ClipboardPlus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";

export default function VicePrincipalDashboard() {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name?.split(" ")[0] ?? "Vice Principal"}`}
        description="Vice Principal — General Admin hiring"
      />
      <div className="max-w-sm">
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-5 flex items-start gap-4">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <ClipboardPlus className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-sm">General Admin Vacancies</p>
              <p className="text-xs text-muted-foreground mt-0.5">Submit General Admin hiring requests for Principal approval</p>
              <Button asChild size="sm" variant="outline" className="mt-3">
                <Link href="/vice-principal/vacancies">View Requests</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
