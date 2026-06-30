"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, Building2, ClipboardList, Settings2, CalendarCheck, FileText } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";

export default function AdministrationDashboard() {
  const user = useAuthStore((s) => s.user);
  const [pendingVacancies, setPendingVacancies] = useState<number | null>(null);
  const [pendingInterviews, setPendingInterviews] = useState<number | null>(null);
  const [pendingOffers, setPendingOffers] = useState<number | null>(null);

  useEffect(() => {
    // API already returns only PENDING_ADMIN requests for ADMINISTRATION role
    fetch("/api/location/vacancy-requests")
      .then((r) => r.json() as Promise<{ vacancyRequests: unknown[] }>)
      .then((d) => setPendingVacancies(d.vacancyRequests?.length ?? 0))
      .catch(() => {});

    fetch("/api/location/interviews")
      .then((r) => r.json() as Promise<{ interviews: unknown[] }>)
      .then((d) => setPendingInterviews(d.interviews?.length ?? 0))
      .catch(() => {});

    fetch("/api/location/offers")
      .then((r) => r.json() as Promise<{ offers: unknown[] }>)
      .then((d) => setPendingOffers(d.offers?.length ?? 0))
      .catch(() => {});
  }, []);

  const actions = [
    { label: "Hiring Requests", href: "/administration/vacancies", icon: ClipboardList, desc: `${pendingVacancies ?? "…"} pending from HR Admin`, section: "Hiring Approvals" },
    { label: "Interview Plans", href: "/administration/interviews", icon: CalendarCheck, desc: `${pendingInterviews ?? "…"} plans awaiting approval`, section: "" },
    { label: "Offer Letters", href: "/administration/offers", icon: FileText, desc: `${pendingOffers ?? "…"} offer letters to approve`, section: "" },
    { label: "Location Staff", href: "/administration/users", icon: Users, desc: "HR Admin, Admin Office, Accounts, Dept Heads", section: "Management" },
    { label: "Departments", href: "/administration/departments", icon: Settings2, desc: "Manage location-level departments", section: "" },
    { label: "Colleges", href: "/administration/colleges", icon: Building2, desc: "View colleges & assign Principals", section: "" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name?.split(" ")[0] ?? "Admin"}`}
        description="Location-level administration overview"
      />

      <div className="space-y-5">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Hiring Approvals</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {actions.slice(0, 3).map((action) => (
              <Card key={action.href} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <action.icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{action.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{action.desc}</p>
                    <Button asChild size="sm" variant="outline" className="mt-3">
                      <Link href={action.href}>Review</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Management</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {actions.slice(3).map((action) => (
              <Card key={action.href} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <action.icon className="h-4 w-4 text-primary" />
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
      </div>
    </div>
  );
}
