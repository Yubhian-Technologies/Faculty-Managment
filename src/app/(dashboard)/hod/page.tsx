"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ClipboardPlus,
  Plus,
  ArrowRight,
  UsersRound,
  ClipboardCheck,
  TrendingUp,
  GraduationCap,
  AlertCircle,
  ChevronRight,
  BookOpen,
  Wallet,
  FolderOpen,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useAuthStore } from "@/store/authStore";
import { useNavVisibility } from "@/hooks/useNavVisibility";
import { useCollegeType } from "@/hooks/useCollegeType";
import { isPathHidden } from "@/components/layout/navConfig";
import { hasSupportingStaffSplit } from "@/lib/designations/config";
import { formatDate } from "@/lib/utils";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import type { Department, VacancyRequest, HiringBatch } from "@/types";

// "Faculty" (teaching) and "Supporting Staff" (Technical, department-scoped)
// are two segregated modules - separate tiles here, separate pages, separate
// Firestore-backed ownership - not one combined "Faculty" entry. Supporting
// Staff is omitted entirely for college types with no Technical/Non-
// Technical split (School - see hasSupportingStaffSplit), matching the same
// nav-hide Sidebar.tsx already applies.
const HOD_MODULES = [
  { label: "Teaching Faculty", description: "Department faculty list", href: "/hod/faculty", icon: UsersRound, color: "bg-blue-50 text-blue-600" },
  { label: "Supporting Staff", description: "Technical staff for your department", href: "/hod/supporting-staff", icon: UsersRound, color: "bg-teal-50 text-teal-600" },
  { label: "Hiring", description: "Pipeline · candidates · sessions", href: "/hod/pipeline", icon: ClipboardPlus, color: "bg-indigo-50 text-indigo-600" },
];

const PERSONAL_MODULES = [
  { label: "My Attendance", description: "Attendance records", href: "/hod/attendance", icon: ClipboardCheck, color: "bg-violet-50 text-violet-600" },
  { label: "Teaching Load", description: "Subjects & timetable", href: "/hod/teaching", icon: BookOpen, color: "bg-orange-50 text-orange-600" },
  { label: "My Payslips", description: "Salary & payslips", href: "/hod/payslips", icon: Wallet, color: "bg-green-50 text-green-600" },
  { label: "My Appraisal", description: "Performance review", href: "/hod/appraisal", icon: TrendingUp, color: "bg-pink-50 text-pink-600" },
  { label: "Training", description: "FDPs & workshops", href: "/hod/training", icon: GraduationCap, color: "bg-cyan-50 text-cyan-600" },
  { label: "Grievance", description: "Raise grievance", href: "/hod/grievance", icon: AlertCircle, color: "bg-red-50 text-red-600" },
  { label: "My Documents", description: "Certificates & letters", href: "/hod/documents", icon: FolderOpen, color: "bg-amber-50 text-amber-600" },
];

export default function HODDashboard() {
  const user = useAuthStore((s) => s.user);
  const { hiddenModules, hiddenItems } = useNavVisibility();
  const { collegeType } = useCollegeType();
  const isHidden = (href: string) => !!user?.role && isPathHidden(href, user.role, hiddenModules, hiddenItems);
  const visibleHodModules = HOD_MODULES
    .filter((m) => !isHidden(m.href))
    .filter((m) => hasSupportingStaffSplit(collegeType) || m.href !== "/hod/supporting-staff");
  const visiblePersonalModules = PERSONAL_MODULES.filter((m) => !isHidden(m.href));
  // "/hod/vacancy", "/hod/vacancy/new" and "/hod/batches" aren't their own nav
  // items - they're sub-pages of the "Hiring" module (whose nav entry is
  // /hod/pipeline) - so gate them off that module's visibility instead.
  const isHiringHidden = isHidden("/hod/pipeline");
  const [vacancies, setVacancies] = useState<VacancyRequest[]>([]);
  const [batches, setBatches] = useState<HiringBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [parentDeptName, setParentDeptName] = useState<string | null>(null);

  useEffect(() => {
    // isLoading already starts true, so nothing is set synchronously here -
    // a setState in the effect body triggers a cascading render.
    void (async () => {
      try {
        const [v, b] = await Promise.all([
          fetch("/api/college/vacancy-requests")
            .then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>)
            .then((d) => d.vacancyRequests ?? []),
          fetch("/api/college/hiring-batches")
            .then((r) => r.json() as Promise<{ batches: HiringBatch[] }>)
            .then((d) => d.batches ?? []),
        ]);
        setVacancies(v);
        setBatches(b);
      } catch {
        // Non-fatal: the dashboard renders with empty lists.
      } finally {
        setIsLoading(false);
      }
    })();

    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => {
        const departments = d.departments ?? [];
        const own = departments.find((dept) => dept.name === user?.department);
        const parent = own?.parentDepartmentId ? departments.find((dept) => dept.id === own.parentDepartmentId) : null;
        setParentDeptName(parent?.name ?? null);
      })
      .catch(() => {});
  }, [user?.department]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name?.split(" ")[0] ?? "HOD"}`}
        description={`${user?.department ?? "Department"}${parentDeptName ? ` (sub-department of ${parentDeptName})` : ""} - Department Portal`}
        actions={
          !isHiringHidden && (
            <Button asChild>
              <Link href="/hod/vacancy/new">
                <Plus className="h-4 w-4 mr-1" />
                New Vacancy
              </Link>
            </Button>
          )
        }
      />

      {/* HOD Management Modules */}
      {visibleHodModules.length > 0 && (
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Department</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {visibleHodModules.map((mod) => (
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
      )}

      {/* Personal Modules (as faculty) */}
      {visiblePersonalModules.length > 0 && (
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">My Work</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {visiblePersonalModules.map((mod) => (
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
      )}

      {/* Recent Vacancies */}
      {!isHiringHidden && (
      <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Recent Hiring Requests</CardTitle>
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
                <p className="text-sm text-muted-foreground mb-3">No hiring requests yet</p>
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

      {/* Active Batches */}
      {!isHiringHidden && (
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
                        {(b.applicationIds ?? []).length} candidate{(b.applicationIds ?? []).length !== 1 ? "s" : ""} · {formatDate(b.interviewDate)}
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
