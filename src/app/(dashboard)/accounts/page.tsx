"use client";

import Link from "next/link";
import { IndianRupee, FileText, TrendingUp, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import { EmptyState } from "@/components/shared/EmptyState";

export default function AccountsDashboard() {
  const user = useAuthStore((s) => s.user);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user?.name?.split(" ")[0] ?? "Accounts"}`}
        description="Salary records and offer letter management"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Pending Salary Setup", value: "—", icon: IndianRupee, color: "text-orange-600 bg-orange-50", href: "/accounts/salary" },
          { label: "Offer Letters Issued", value: "—", icon: FileText, color: "text-green-600 bg-green-50", href: "/accounts/offers" },
          { label: "Avg CTC", value: "—", icon: TrendingUp, color: "text-blue-600 bg-blue-50", href: "/accounts/salary" },
          { label: "New Joiners", value: "—", icon: Users, color: "text-purple-600 bg-purple-50", href: "/accounts/salary" },
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

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" asChild className="w-full justify-start">
              <Link href="/accounts/salary">
                <IndianRupee className="h-4 w-4 mr-2" />
                View Salary Records
              </Link>
            </Button>
            <Button variant="outline" asChild className="w-full justify-start">
              <Link href="/accounts/offers">
                <FileText className="h-4 w-4 mr-2" />
                Manage Offer Letters
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              title="No recent activity"
              description="Salary records and offer letters will appear here once hiring decisions are made."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
