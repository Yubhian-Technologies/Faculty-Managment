"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, Users, CalendarCheck, FileText } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";

export default function HRAdminDashboard() {
  const user = useAuthStore((s) => s.user);
  const [pendingVacancies, setPendingVacancies] = useState<number | null>(null);
  const [pendingCandidates, setPendingCandidates] = useState<number | null>(null);
  const [pendingInterviews, setPendingInterviews] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/location/vacancy-requests")
      .then((r) => r.json() as Promise<{ vacancyRequests: { status: string }[] }>)
      .then((d) => setPendingVacancies((d.vacancyRequests ?? []).filter((v) => v.status === "PENDING_HR").length))
      .catch(() => {});

    fetch("/api/location/candidates")
      .then((r) => r.json() as Promise<{ candidates: { status: string }[] }>)
      .then((d) => setPendingCandidates((d.candidates ?? []).filter((c) => c.status === "PENDING").length))
      .catch(() => {});

    fetch("/api/location/interviews")
      .then((r) => r.json() as Promise<{ interviews: { status: string }[] }>)
      .then((d) => setPendingInterviews((d.interviews ?? []).filter((i) => i.status === "PENDING_ADMIN").length))
      .catch(() => {});
  }, []);

  const actions = [
    {
      label: "Hiring Requests",
      href: "/hr-admin/vacancies",
      icon: ClipboardList,
      desc: `${pendingVacancies ?? "…"} pending from Dept Heads — forward to Administration`,
    },
    {
      label: "Candidates",
      href: "/hr-admin/candidates",
      icon: Users,
      desc: `${pendingCandidates ?? "…"} pending review — shortlist or reject`,
    },
    {
      label: "Interview Plans",
      href: "/hr-admin/interviews",
      icon: CalendarCheck,
      desc: `${pendingInterviews ?? "…"} awaiting Administration approval`,
    },
    {
      label: "Offer Letters",
      href: "/hr-admin/offers",
      icon: FileText,
      desc: "Prepare offer letters for selected candidates",
    },
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
