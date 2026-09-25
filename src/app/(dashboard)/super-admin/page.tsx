"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Users, ScrollText, TrendingUp } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import { useNavVisibility } from "@/hooks/useNavVisibility";
import { isPathHidden } from "@/components/layout/navConfig";
import { useAdminColleges } from "@/hooks/useAdminColleges";

interface Stats {
  colleges: number;
  activeColleges: number;
}

interface DashboardStats {
  activeUsers: number;
  ongoingHirings: number;
  auditEvents: number;
  auditWindowDays: number;
  systemHealth: { firestore: boolean; authentication: boolean; storage: boolean };
}

export default function SuperAdminDashboard() {
  const user = useAuthStore((s) => s.user);
  const { hiddenModules, hiddenItems } = useNavVisibility();
  const isHidden = useCallback(
    (href: string) => !!user?.role && isPathHidden(href, user.role, hiddenModules, hiddenItems),
    [user, hiddenModules, hiddenItems]
  );
  // Batch 2 example: shared hook with staleTime 5m — cached across admin pages
  const { data: collegesData } = useAdminColleges();
  const stats: Stats | null = useMemo(() => {
    if (!collegesData) return null;
    return {
      colleges: collegesData.length,
      activeColleges: collegesData.filter((c) => c.isActive).length,
    };
  }, [collegesData]);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    fetch("/api/admin/dashboard-stats")
      .then((r) => r.json() as Promise<DashboardStats>)
      .then(setDashboardStats)
      .catch(() => {});
  }, []);

  const statCards = useMemo(
    () => [
      {
        label: "Total Colleges",
        value: stats ? String(stats.colleges) : "-",
        sub: stats ? `${stats.activeColleges} active` : undefined,
        icon: Building2,
        color: "text-blue-600 bg-blue-50",
      },
      {
        label: "Active Users",
        value: dashboardStats ? String(dashboardStats.activeUsers) : "-",
        icon: Users,
        color: "text-green-600 bg-green-50",
      },
      {
        label: "Ongoing Hirings",
        value: dashboardStats ? String(dashboardStats.ongoingHirings) : "-",
        icon: TrendingUp,
        color: "text-orange-600 bg-orange-50",
      },
      {
        label: "Audit Events",
        value: dashboardStats ? String(dashboardStats.auditEvents) : "-",
        sub: dashboardStats ? `last ${dashboardStats.auditWindowDays} days` : undefined,
        icon: ScrollText,
        color: "text-purple-600 bg-purple-50",
      },
    ],
    [stats, dashboardStats]
  );

  const healthChecks = useMemo(
    () =>
      dashboardStats
        ? [
            { label: "Firestore", ok: dashboardStats.systemHealth.firestore },
            { label: "Authentication", ok: dashboardStats.systemHealth.authentication },
            { label: "Storage", ok: dashboardStats.systemHealth.storage },
          ]
        : [
            { label: "Firestore", ok: undefined },
            { label: "Authentication", ok: undefined },
            { label: "Storage", ok: undefined },
          ],
    [dashboardStats]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name ?? "Admin"}`}
        description="System-wide overview of all colleges and operations"
        actions={
          !isHidden("/super-admin/colleges") && (
            <Button asChild>
              <Link href="/super-admin/colleges">Manage Colleges</Link>
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${stat.color}`}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-xl font-bold">{stat.value}</p>
                {stat.sub && <p className="text-xs text-muted-foreground">{stat.sub}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3">
            {[
              { href: "/super-admin/colleges/new", icon: Building2, label: "Add New College" },
              { href: "/super-admin/users/new", icon: Users, label: "Create User" },
              { href: "/super-admin/audit-logs", icon: ScrollText, label: "View Audit Logs" },
            ].filter((a) => !isHidden(a.href)).map((a) => (
              <Button key={a.href} variant="outline" asChild className="justify-start">
                <Link href={a.href}>
                  <a.icon className="h-4 w-4 mr-2" />{a.label}
                </Link>
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">System Health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {healthChecks.map(({ label, ok }) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className={`font-medium flex items-center gap-1 ${ok === undefined ? "text-muted-foreground" : ok ? "text-green-600" : "text-red-600"}`}>
                  <span className={`h-2 w-2 rounded-full inline-block ${ok === undefined ? "bg-muted-foreground/40 animate-pulse" : ok ? "bg-green-500" : "bg-red-500"}`} />
                  {ok === undefined ? "Checking…" : ok ? "Operational" : "Error"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
