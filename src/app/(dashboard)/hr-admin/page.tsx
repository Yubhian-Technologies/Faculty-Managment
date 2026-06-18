"use client";

import Link from "next/link";
import { ClipboardPlus, Users, BarChart2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";

export default function HRAdminDashboard() {
  const user = useAuthStore((s) => s.user);

  const actions = [
    { label: "Vacancy Requests", href: "/hr-admin/vacancies", icon: ClipboardPlus, desc: "Submit and track vacancy requests to Administration" },
    { label: "Candidates", href: "/hr-admin/candidates", icon: Users, desc: "All candidates for location positions" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name?.split(" ")[0] ?? "HR Admin"}`}
        description="Location-level HR management"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {actions.map((a) => (
          <Card key={a.href} className="hover:shadow-md transition-shadow">
            <CardContent className="p-5 flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <a.icon className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm">{a.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{a.desc}</p>
                <Button asChild size="sm" variant="outline" className="mt-3">
                  <Link href={a.href}>Open</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
