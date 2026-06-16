"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ClipboardPlus,
  Users,
  Layers,
  Plus,
  ArrowRight,
  UsersRound,
  CalendarClock,
  ClipboardCheck,
  TrendingUp,
  GraduationCap,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useAuthStore } from "@/store/authStore";
import { formatDate } from "@/lib/utils";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import type { VacancyRequest, HiringBatch } from "@/types";

const STATIC_MODULES = [
  {
    label: "Faculty",
    description: "Department faculty list",
    href: "/hod/faculty",
    icon: UsersRound,
    color: "bg-blue-50 text-blue-600",
  },
  {
    label: "Leave Approvals",
    description: "Review faculty leave",
    href: "/hod/leave",
    icon: CalendarClock,
    color: "bg-emerald-50 text-emerald-600",
  },
  {
    label: "Attendance",
    description: "Department attendance",
    href: "/hod/attendance",
    icon: ClipboardCheck,
    color: "bg-violet-50 text-violet-600",
  },
  {
    label: "Appraisals",
    description: "Faculty performance review",
    href: "/hod/appraisals",
    icon: TrendingUp,
    color: "bg-pink-50 text-pink-600",
  },
  {
    label: "Training",
    description: "FDPs & workshops",
    href: "/hod/training",
    icon: GraduationCap,
    color: "bg-cyan-50 text-cyan-600",
  },
  {
    label: "Grievances",
    description: "Faculty grievances",
    href: "/hod/grievances",
    icon: AlertCircle,
    color: "bg-red-50 text-red-600",
  },
];

const RECRUITMENT_MODULE = {
  label: "Recruitment",
  description: "Vacancies, candidates & batches",
  href: "/hod/vacancy",
  icon: ClipboardPlus,
  color: "bg-indigo-50 text-indigo-600",
};

export default function HODDashboard() {
  const user = useAuthStore((s) => s.user);
  const [vacancies, setVacancies] = useState<VacancyRequest[]>([]);
  const [batches, setBatches] = useState<HiringBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      fetch("/api/college/vacancy-requests")
        .then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>)
        .then((d) => d.vacancyRequests ?? []),
      fetch("/api/college/hiring-batches")
        .then((r) => r.json() as Promise<{ batches: HiringBatch[] }>)
        .then((d) => d.batches ?? []),
    ])
      .then(([v, b]) => {
        setVacancies(v);
        setBatches(b);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const hasRecruitmentActivity = vacancies.length > 0 || batches.length > 0;
  const activeBatches = batches.filter((b) => b.status !== "REJECTED" && b.status !== "COMPLETED");

  const modules = hasRecruitmentActivity
    ? [RECRUITMENT_MODULE, ...STATIC_MODULES]
    : STATIC_MODULES;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name?.split(" ")[0] ?? "HOD"}`}
        description={`${user?.department ?? "Department"} — Department Portal`}
        actions={
          <Button asChild>
            <Link href="/hod/vacancy/new">
              <Plus className="h-4 w-4 mr-1" />
              New Vacancy
            </Link>
          </Button>
        }
      />

      {/* Quick Stats — only shown when recruitment is active */}
      {(isLoading || hasRecruitmentActivity) && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {[
            {
              label: "Vacancy Requests",
              value: isLoading ? "—" : vacancies.length,
              icon: ClipboardPlus,
              color: "text-blue-600 bg-blue-50",
              href: "/hod/vacancy",
            },
            {
              label: "Active Batches",
              value: isLoading ? "—" : activeBatches.length,
              icon: Layers,
              color: "text-purple-600 bg-purple-50",
              href: "/hod/batches",
            },
            {
              label: "Total Candidates",
              value: isLoading ? "—" : batches.reduce((acc, b) => acc + b.candidateIds.length, 0),
              icon: Users,
              color: "text-green-600 bg-green-50",
              href: "/hod/candidates",
            },
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
      )}

      {/* Module Grid */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          My Modules
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {modules.map((mod) => (
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

      {/* Recent Vacancies — only when recruitment active */}
      {(isLoading || hasRecruitmentActivity) && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Recent Vacancy Requests</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/hod/vacancy" className="text-primary">
                View all <ArrowRight className="h-3 w-3 ml-1 inline" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">{[1, 2].map((i) => <CardSkeleton key={i} />)}</div>
            ) : !vacancies.length ? (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground mb-3">No vacancy requests yet</p>
                <Button asChild size="sm">
                  <Link href="/hod/vacancy/new">Create First Request</Link>
                </Button>
              </div>
            ) : (
              <div className="divide-y">
                {vacancies.slice(0, 4).map((v) => (
                  <div key={v.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium text-sm">{v.position}</p>
                      <p className="text-xs text-muted-foreground">
                        {v.requiredCount} position{v.requiredCount > 1 ? "s" : ""} · {formatDate(v.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={v.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Active Batches — only when batches exist */}
      {(isLoading || batches.length > 0) && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Active Hiring Batches</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/hod/batches" className="text-primary">
                View all <ArrowRight className="h-3 w-3 ml-1 inline" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">{[1, 2].map((i) => <CardSkeleton key={i} />)}</div>
            ) : (
              <div className="divide-y">
                {batches.slice(0, 4).map((b) => (
                  <div key={b.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium text-sm">{b.position}</p>
                      <p className="text-xs text-muted-foreground">
                        {b.candidateIds.length} candidate{b.candidateIds.length !== 1 ? "s" : ""} · {formatDate(b.interviewDate)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={b.status} />
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/hod/batches/${b.id}`}>Open</Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
