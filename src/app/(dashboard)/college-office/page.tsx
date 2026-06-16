"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building, FolderOpen, UserCog, CheckCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDate } from "@/lib/utils";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { useAuthStore } from "@/store/authStore";
import type { HiringBatch } from "@/types";

export default function CollegeOfficeDashboard() {
  const user = useAuthStore((s) => s.user);
  const [batches, setBatches] = useState<HiringBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/hiring-batches?status=APPROVED")
      .then((r) => r.json() as Promise<{ batches: HiringBatch[] }>)
      .then((d) => setBatches(d.batches ?? []))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const pendingSetup = batches.filter((b) => !b.setupComplete);
  const doneSetup = batches.filter((b) => b.setupComplete);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user?.name?.split(" ")[0] ?? "Office"}`}
        description="Manage interview logistics and documentation"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Pending Setups", value: isLoading ? "—" : pendingSetup.length, icon: Building, color: "text-orange-600 bg-orange-50", href: "/college-office/setup" },
          { label: "Documents Due", value: "—", icon: FolderOpen, color: "text-blue-600 bg-blue-50", href: "/college-office/setup" },
          { label: "Candidates Today", value: "—", icon: UserCog, color: "text-green-600 bg-green-50", href: "/college-office/setup" },
          { label: "Setups Complete", value: isLoading ? "—" : doneSetup.length, icon: CheckCircle, color: "text-purple-600 bg-purple-50", href: "/college-office/setup" },
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
          <CardTitle className="text-base">Batches Awaiting Setup</CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link href="/college-office/setup">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">{[1, 2].map((i) => <CardSkeleton key={i} />)}</div>
          ) : !pendingSetup.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              All setups are complete!
            </p>
          ) : (
            <div className="divide-y">
              {pendingSetup.slice(0, 5).map((b) => (
                <div key={b.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium text-sm">{b.position}</p>
                    <p className="text-xs text-muted-foreground">
                      Interview: {formatDate(b.interviewDate)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={b.status} />
                    <Button size="sm" asChild>
                      <Link href={`/college-office/setup/${b.id}`}>Setup</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
