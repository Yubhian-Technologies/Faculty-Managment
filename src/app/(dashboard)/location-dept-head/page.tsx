"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, ClipboardPlus, CalendarCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";

export default function LocationDeptHeadDashboard() {
  const user = useAuthStore((s) => s.user);
  const [pendingVacancies, setPendingVacancies] = useState<number | null>(null);
  const [pendingCandidates, setPendingCandidates] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/location/vacancy-requests")
      .then((r) => r.json() as Promise<{ vacancyRequests: { status: string }[] }>)
      .then((d) => {
        // All returned requests belong to this HOD; show those still in progress
        const active = (d.vacancyRequests ?? []).filter((v) => v.status !== "REJECTED");
        setPendingVacancies(active.filter((v) => v.status === "PENDING_HR").length);
      })
      .catch(() => {});

    fetch("/api/location/candidates")
      .then((r) => r.json() as Promise<{ candidates: { status: string; department: string }[] }>)
      .then((d) => {
        const myDept = user?.department;
        const deptCandidates = myDept
          ? (d.candidates ?? []).filter((c) => c.department === myDept)
          : (d.candidates ?? []);
        setPendingCandidates(deptCandidates.filter((c) => c.status === "PENDING").length);
      })
      .catch(() => {});
  }, [user?.department]);

  const actions = [
    {
      label: "Vacancy Requests",
      href: "/location-dept-head/vacancies",
      icon: ClipboardPlus,
      desc: pendingVacancies !== null && pendingVacancies > 0
        ? `${pendingVacancies} request${pendingVacancies > 1 ? "s" : ""} pending HR review`
        : "Request faculty positions for your department",
    },
    {
      label: "Candidates",
      href: "/location-dept-head/candidates",
      icon: Users,
      desc: pendingCandidates !== null && pendingCandidates > 0
        ? `${pendingCandidates} candidate${pendingCandidates > 1 ? "s" : ""} pending review`
        : "View and add faculty candidates for your department",
    },
    {
      label: "My Interviews",
      href: "/location-dept-head/interviews",
      icon: CalendarCheck,
      desc: "View interviews you are assigned to and submit panel feedback",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name?.split(" ")[0] ?? "Dept Head"}`}
        description={`${user?.department ?? "Location"} Department Head`}
      />
      <div className="grid gap-4 sm:grid-cols-3">
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
