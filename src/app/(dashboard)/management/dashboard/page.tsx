"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, BookOpen, UsersRound, IdCard } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

interface Stats {
  totalColleges: number;
  totalDepartments: number;
  totalFaculty: number;
  totalStaffAccounts: number;
}

export default function ManagementDashboardPage() {
  const { data: stats } = useQuery({
    queryKey: ["mgmt-stats"],
    queryFn: () => fetch("/api/management/stats").then((r) => r.json() as Promise<Stats>),
  });

  const statCards = [
    { label: "Total Colleges", value: stats?.totalColleges, icon: Building2, color: "text-blue-600 bg-blue-50" },
    { label: "Total Departments", value: stats?.totalDepartments, icon: BookOpen, color: "text-orange-600 bg-orange-50" },
    { label: "Total Faculty", value: stats?.totalFaculty, icon: UsersRound, color: "text-green-600 bg-green-50" },
    { label: "Staff Accounts", value: stats?.totalStaffAccounts, icon: IdCard, color: "text-purple-600 bg-purple-50" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="System-wide overview across all colleges" />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.label} className="shadow-md hover:shadow-lg transition-shadow duration-200">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${stat.color}`}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-xl font-bold">{stat.value ?? "—"}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="shadow-md hover:shadow-lg transition-shadow duration-200">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="font-medium">Budget</p>
              <p className="text-sm text-muted-foreground">Browse colleges to view budget information</p>
            </div>
            <Link href="/management/budget" className="text-sm font-medium text-primary hover:underline">
              View →
            </Link>
          </CardContent>
        </Card>
        <Card className="shadow-md hover:shadow-lg transition-shadow duration-200">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="font-medium">Faculty Details</p>
              <p className="text-sm text-muted-foreground">Browse colleges, principals, and departments</p>
            </div>
            <Link href="/management/faculty" className="text-sm font-medium text-primary hover:underline">
              View →
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
