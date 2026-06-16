"use client";

import { useEffect, useState } from "react";
import { Building2, Users, ScrollText, TrendingUp } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import type { College } from "@/types";

interface Stats {
  colleges: number;
  activeColleges: number;
}

export default function SuperAdminDashboard() {
  const user = useAuthStore((s) => s.user);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/admin/colleges")
      .then((r) => r.json() as Promise<{ colleges: College[] }>)
      .then((data) => {
        const colleges = data.colleges ?? [];
        setStats({
          colleges: colleges.length,
          activeColleges: colleges.filter((c) => c.isActive).length,
        });
      })
      .catch(() => {});
  }, []);

  const statCards = [
    {
      label: "Total Colleges",
      value: stats ? String(stats.colleges) : "—",
      sub: stats ? `${stats.activeColleges} active` : undefined,
      icon: Building2,
      color: "text-blue-600 bg-blue-50",
    },
    {
      label: "Active Users",
      value: "—",
      icon: Users,
      color: "text-green-600 bg-green-50",
    },
    {
      label: "Ongoing Hirings",
      value: "—",
      icon: TrendingUp,
      color: "text-orange-600 bg-orange-50",
    },
    {
      label: "Audit Events",
      value: "—",
      icon: ScrollText,
      color: "text-purple-600 bg-purple-50",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name?.split(" ")[0] ?? "Admin"}`}
        description="System-wide overview of all colleges and operations"
        actions={
          <Button asChild>
            <Link href="/super-admin/colleges">Manage Colleges</Link>
          </Button>
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
            <Button variant="outline" asChild className="justify-start">
              <Link href="/super-admin/colleges/new">
                <Building2 className="h-4 w-4 mr-2" />Add New College
              </Link>
            </Button>
            <Button variant="outline" asChild className="justify-start">
              <Link href="/super-admin/users/new">
                <Users className="h-4 w-4 mr-2" />Create User
              </Link>
            </Button>
            <Button variant="outline" asChild className="justify-start">
              <Link href="/super-admin/audit-logs">
                <ScrollText className="h-4 w-4 mr-2" />View Audit Logs
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">System Health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Firestore", ok: true },
              { label: "Authentication", ok: true },
              { label: "Storage", ok: true },
            ].map(({ label, ok }) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className={`font-medium flex items-center gap-1 ${ok ? "text-green-600" : "text-red-600"}`}>
                  <span className={`h-2 w-2 rounded-full inline-block ${ok ? "bg-green-500" : "bg-red-500"}`} />
                  {ok ? "Operational" : "Error"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
