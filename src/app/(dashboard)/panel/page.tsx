"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  CalendarClock,
  ClipboardCheck,
  BookOpen,
  Wallet,
  TrendingUp,
  GraduationCap,
  AlertCircle,
  FolderOpen,
  QrCode,
  ChevronRight,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/store/authStore";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDate } from "@/lib/utils";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { EmptyState } from "@/components/shared/EmptyState";
import type { HiringBatch } from "@/types";

const STATIC_MODULES = [
  {
    label: "Leave",
    description: "Apply & track leave",
    href: "/panel/leave",
    icon: CalendarClock,
    color: "bg-blue-50 text-blue-600",
  },
  {
    label: "Attendance",
    description: "Monthly attendance record",
    href: "/panel/attendance",
    icon: ClipboardCheck,
    color: "bg-emerald-50 text-emerald-600",
  },
  {
    label: "Teaching Load",
    description: "Subjects & timetable",
    href: "/panel/teaching",
    icon: BookOpen,
    color: "bg-violet-50 text-violet-600",
  },
  {
    label: "Payslips",
    description: "Monthly salary slips",
    href: "/panel/payslips",
    icon: Wallet,
    color: "bg-amber-50 text-amber-600",
  },
  {
    label: "Appraisal",
    description: "Performance appraisal",
    href: "/panel/appraisal",
    icon: TrendingUp,
    color: "bg-pink-50 text-pink-600",
  },
  {
    label: "Training",
    description: "FDPs & workshops",
    href: "/panel/training",
    icon: GraduationCap,
    color: "bg-cyan-50 text-cyan-600",
  },
  {
    label: "Grievance",
    description: "Raise & track issues",
    href: "/panel/grievance",
    icon: AlertCircle,
    color: "bg-red-50 text-red-600",
  },
  {
    label: "My Documents",
    description: "Upload & verify docs",
    href: "/panel/documents",
    icon: FolderOpen,
    color: "bg-slate-50 text-slate-600",
  },
];

const INTERVIEW_MODULE = {
  label: "My Interviews",
  description: "Panel assignments & feedback",
  href: "/panel/interviews",
  icon: CalendarDays,
  color: "bg-indigo-50 text-indigo-600",
};

export default function FacultyDashboard() {
  const user = useAuthStore((s) => s.user);
  const [batches, setBatches] = useState<HiringBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/hiring-batches")
      .then((r) => r.json() as Promise<{ batches: HiringBatch[] }>)
      .then((d) => setBatches(d.batches ?? []))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const upcomingInterviews = batches.filter(
    (b) => b.status === "APPROVED" || b.status === "IN_PROGRESS"
  );

  // Only show interview module card when assigned to batches
  const modules = batches.length > 0
    ? [INTERVIEW_MODULE, ...STATIC_MODULES]
    : STATIC_MODULES;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user?.name?.split(" ")[0] ?? "Faculty"}`}
        description={user?.department ? `${user.department} Department` : "Faculty Portal"}
      />

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 bg-blue-50 text-blue-600">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Upcoming Interviews</p>
              <p className="text-xl font-bold">{isLoading ? "—" : upcomingInterviews.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 bg-emerald-50 text-emerald-600">
              <ClipboardCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Attendance (June)</p>
              <p className="text-xl font-bold text-emerald-600">—</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 bg-amber-50 text-amber-600">
              <CalendarClock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Leave Balance</p>
              <p className="text-xl font-bold">—</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 bg-violet-50 text-violet-600">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Subjects (Sem)</p>
              <p className="text-xl font-bold">—</p>
            </div>
          </CardContent>
        </Card>
      </div>

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

      {/* Interview Panel Assignments — only shown when assigned */}
      {(isLoading || batches.length > 0) && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Interview Panel Assignments</CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link href="/panel/interviews">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">{[1, 2].map((i) => <CardSkeleton key={i} />)}</div>
            ) : (
              <div className="divide-y">
                {batches.slice(0, 5).map((b) => {
                  const isCoordinator = b.coordinatorUid === user?.uid;
                  return (
                    <div key={b.id} className="flex items-center justify-between py-3 gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm truncate">{b.position}</p>
                          {isCoordinator && (
                            <Badge variant="secondary" className="text-xs shrink-0">Coordinator</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(b.interviewDate)}
                          {b.interviewVenue && ` · ${b.interviewVenue}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {b.candidateIds.length} candidate{b.candidateIds.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={b.status} />
                        {isCoordinator && b.setupComplete && (
                          <Button size="sm" variant="default" asChild>
                            <Link href={`/coordinator/${b.id}`}>
                              <QrCode className="h-3.5 w-3.5 mr-1" />
                              QR
                            </Link>
                          </Button>
                        )}
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/panel/interviews/${b.id}`}>View</Link>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Completed interviews */}
      {!isLoading && batches.filter((b) => b.status === "COMPLETED").length > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          {batches.filter((b) => b.status === "COMPLETED").length} completed interview{batches.filter((b) => b.status === "COMPLETED").length !== 1 ? "s" : ""} in total
          <Link href="/panel/interviews" className="text-primary underline-offset-4 hover:underline ml-1">
            View history
          </Link>
        </div>
      )}
    </div>
  );
}
