"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ClipboardList,
  CalendarCheck,
  UserCheck,
  Clock,
  CalendarClock,
  ClipboardCheck,
  Wallet,
  GraduationCap,
  AlertCircle,
  FolderOpen,
  ChevronRight,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useAuthStore } from "@/store/authStore";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { formatDate } from "@/lib/utils";
import type { VacancyRequest, HiringBatch } from "@/types";

const ADMIN_MODULES = [
  { label: "Leave Approvals", description: "Approve HOD leave requests", href: "/principal/leave", icon: CalendarClock, color: "bg-sky-50 text-sky-600" },
  { label: "Attendance Report", description: "College-wide attendance", href: "/principal/attendance", icon: ClipboardCheck, color: "bg-violet-50 text-violet-600" },
  { label: "Payroll", description: "All staff salary overview", href: "/principal/payslips", icon: Wallet, color: "bg-green-50 text-green-600" },
  { label: "Training Approvals", description: "Sanction FDPs & workshops", href: "/principal/training", icon: GraduationCap, color: "bg-cyan-50 text-cyan-600" },
  { label: "Grievance Desk", description: "Resolve escalated grievances", href: "/principal/grievance", icon: AlertCircle, color: "bg-red-50 text-red-600" },
  { label: "Documents", description: "Official college documents", href: "/principal/documents", icon: FolderOpen, color: "bg-amber-50 text-amber-600" },
];

export default function PrincipalDashboard() {
  const user = useAuthStore((s) => s.user);
  const [pendingVacancies, setPendingVacancies] = useState<VacancyRequest[]>([]);
  const [pendingBatches, setPendingBatches] = useState<HiringBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      fetch("/api/college/vacancy-requests?status=PENDING")
        .then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>)
        .then((d) => d.vacancyRequests ?? []),
      fetch("/api/college/hiring-batches?status=PENDING")
        .then((r) => r.json() as Promise<{ batches: HiringBatch[] }>)
        .then((d) => d.batches ?? []),
    ])
      .then(([v, b]) => {
        setPendingVacancies(v);
        setPendingBatches(b);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user?.name?.split(" ")[0] ?? "Principal"}`}
        description="Pending approvals and hiring status"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Pending Vacancies", value: isLoading ? "—" : pendingVacancies.length, icon: ClipboardList, color: "text-yellow-600 bg-yellow-50", href: "/principal/vacancies" },
          { label: "Interview Plans", value: isLoading ? "—" : pendingBatches.length, icon: CalendarCheck, color: "text-blue-600 bg-blue-50", href: "/principal/interviews" },
          { label: "Hiring Decisions", value: "—", icon: UserCheck, color: "text-green-600 bg-green-50", href: "/principal/decisions" },
          { label: "Avg. Process Time", value: "—", icon: Clock, color: "text-purple-600 bg-purple-50", href: "/principal/reports" },
        ].map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${stat.color}`}>
                  <stat.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="text-xl font-bold">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base">Pending Vacancy Requests</CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link href="/principal/vacancies">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
            </div>
          ) : !pendingVacancies.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No pending requests — you are all caught up!
            </p>
          ) : (
            <div className="space-y-3">
              {pendingVacancies.slice(0, 5).map((v) => (
                <div key={v.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium text-sm">{v.position}</p>
                    <p className="text-xs text-muted-foreground">{v.department} · {v.hodName}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(v.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={v.status} />
                    <Button size="sm" asChild>
                      <Link href="/principal/vacancies">Review</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {pendingBatches.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Pending Interview Plans</CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link href="/principal/interviews">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pendingBatches.slice(0, 3).map((b) => (
                <div key={b.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium text-sm">{b.position}</p>
                    <p className="text-xs text-muted-foreground">{b.department} · {formatDate(b.interviewDate)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={b.status} />
                    <Button size="sm" asChild>
                      <Link href="/principal/interviews">Review</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Administration Modules */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Administration</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {ADMIN_MODULES.map((mod) => (
            <Link key={mod.href} href={mod.href}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardContent className="p-4 flex flex-col gap-3">
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${mod.color}`}>
                    <mod.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{mod.label}</p>
                    <p className="text-xs text-muted-foreground">{mod.description}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto mt-auto" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
