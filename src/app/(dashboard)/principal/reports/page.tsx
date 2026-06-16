"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import {
  Users,
  UserCheck,
  ClipboardList,
  GraduationCap,
  Building2,
  BarChart2,
} from "lucide-react";
import type { FacultyMember, HiringBatch } from "@/types";

type ReportStats = {
  totalFaculty: number;
  activeFaculty: number;
  onLeaveFaculty: number;
  departments: string[];
  openVacancies: number;
  completedBatches: number;
  inProgressBatches: number;
  recentBatches: HiringBatch[];
  byDepartment: Record<string, number>;
};

export default function PrincipalReportsPage() {
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      fetch("/api/college/faculty")
        .then((r) => r.json() as Promise<{ faculty: FacultyMember[] }>)
        .then((d) => d.faculty ?? []),
      fetch("/api/college/hiring-batches")
        .then((r) => r.json() as Promise<{ batches: HiringBatch[] }>)
        .then((d) => d.batches ?? []),
      fetch("/api/college/vacancy-requests")
        .then((r) => r.json() as Promise<{ vacancies: { status?: string }[] }>)
        .then((d) => d.vacancies ?? [])
        .catch(() => [] as { status?: string }[]),
    ])
      .then(([faculty, batches, vacancies]) => {
        const byDept: Record<string, number> = {};
        for (const f of faculty) {
          byDept[f.department] = (byDept[f.department] ?? 0) + 1;
        }
        setStats({
          totalFaculty: faculty.length,
          activeFaculty: faculty.filter((f) => f.status === "ACTIVE").length,
          onLeaveFaculty: faculty.filter((f) => f.status === "ON_LEAVE").length,
          departments: [...new Set(faculty.map((f) => f.department))].sort(),
          openVacancies: vacancies.filter((v) => v.status === "APPROVED" || v.status === "PENDING").length,
          completedBatches: batches.filter((b) => b.currentPhase === "COMPLETED").length,
          inProgressBatches: batches.filter((b) => b.currentPhase !== "COMPLETED" && b.status !== "REJECTED").length,
          recentBatches: batches.slice(0, 6),
          byDepartment: byDept,
        });
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load reports" }))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Institution Reports"
        description="Overview of faculty strength, hiring activity, and department breakdown"
      />

      {isLoading ? (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => <CardSkeleton key={i} />)}
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3">
            {[
              { label: "Total Faculty", value: stats?.totalFaculty ?? 0, icon: Users, color: "text-blue-600" },
              { label: "Active Faculty", value: stats?.activeFaculty ?? 0, icon: UserCheck, color: "text-green-600" },
              { label: "On Leave", value: stats?.onLeaveFaculty ?? 0, icon: BarChart2, color: "text-amber-600" },
              { label: "Open Vacancies", value: stats?.openVacancies ?? 0, icon: ClipboardList, color: "text-purple-600" },
              { label: "Hiring Completed", value: stats?.completedBatches ?? 0, icon: GraduationCap, color: "text-teal-600" },
              { label: "Departments", value: stats?.departments.length ?? 0, icon: Building2, color: "text-indigo-600" },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="p-4 flex items-center gap-3">
                  <s.icon className={`h-8 w-8 ${s.color} shrink-0`} />
                  <div>
                    <p className="text-2xl font-bold">{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Faculty by Department */}
          {stats && Object.keys(stats.byDepartment).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Faculty by Department</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries(stats.byDepartment)
                    .sort(([, a], [, b]) => b - a)
                    .map(([dept, count]) => (
                      <div key={dept} className="flex items-center gap-3">
                        <span className="text-sm flex-1 truncate">{dept}</span>
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2 rounded-full bg-primary"
                            style={{ width: `${Math.max(20, (count / (stats.totalFaculty || 1)) * 180)}px` }}
                          />
                          <span className="text-sm font-medium w-6 text-right">{count}</span>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent Hiring Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Hiring Batches</CardTitle>
            </CardHeader>
            <CardContent>
              {(stats?.recentBatches.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">No hiring batches yet.</p>
              ) : (
                <div className="space-y-2">
                  {stats?.recentBatches.map((b) => (
                    <div key={b.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <p className="text-sm font-medium">{b.position}</p>
                        <p className="text-xs text-muted-foreground">
                          {b.department} · {formatDate(b.interviewDate)}
                        </p>
                      </div>
                      <Badge variant={b.currentPhase === "COMPLETED" ? "default" : "secondary"}>
                        {(b.currentPhase ?? b.status).replace(/_/g, " ")}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
