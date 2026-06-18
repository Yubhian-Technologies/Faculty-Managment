"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, Building2, ClipboardList, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";

export default function AdministrationDashboard() {
  const user = useAuthStore((s) => s.user);
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/location/vacancy-requests")
      .then((r) => r.json() as Promise<{ vacancyRequests: { status: string }[] }>)
      .then((d) => setPendingCount((d.vacancyRequests ?? []).filter((v) => v.status === "PENDING").length))
      .catch(() => {});
  }, []);

  const actions = [
    { label: "Manage Location Users", href: "/administration/users", icon: Users, desc: "Add HR Admin, Admin Office, Accounts staff" },
    { label: "Location Departments", href: "/administration/departments", icon: Settings2, desc: "Manage Electrical, Civil, Accounts dept heads" },
    { label: "Vacancy Requests", href: "/administration/vacancies", icon: ClipboardList, desc: `${pendingCount ?? "…"} pending requests from HR Admin` },
    { label: "Colleges", href: "/administration/colleges", icon: Building2, desc: "View colleges & assign Principals" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name?.split(" ")[0] ?? "Admin"}`}
        description="Location-level administration overview"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {actions.map((action) => (
          <Card key={action.href} className="hover:shadow-md transition-shadow">
            <CardContent className="p-5 flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <action.icon className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{action.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{action.desc}</p>
                <Button asChild size="sm" variant="outline" className="mt-3">
                  <Link href={action.href}>Open</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
