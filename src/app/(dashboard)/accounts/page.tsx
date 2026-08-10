"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Landmark, Plus, FileText, Clock } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import type { SalaryStructure, CandidateApplication } from "@/types";

export default function AccountsDashboard() {
  const user = useAuthStore((s) => s.user);
  const [structureCount, setStructureCount] = useState<number | null>(null);
  const [pendingOffers, setPendingOffers] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/college/salary-structures")
        .then((r) => r.json() as Promise<{ salaryStructures: SalaryStructure[] }>)
        .then((d) => setStructureCount((d.salaryStructures ?? []).length)),
      fetch("/api/college/candidate-applications?stage=DECISION")
        .then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>)
        .then((d) => setPendingOffers((d.applications ?? []).filter((a) => a.status !== "REJECTED").length)),
    ]).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user?.name?.split(" ")[0] ?? "Accounts"}`}
        description="Offer letters and salary structure management"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/accounts/hiring">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 text-orange-600 bg-orange-50">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending Offer Letters</p>
                <p className="text-xl font-bold">{pendingOffers === null ? "…" : pendingOffers}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/accounts/hiring">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 text-blue-600 bg-blue-50">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Offer Letters</p>
                <p className="text-xl font-bold">-</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/accounts/salary-structures">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 text-purple-600 bg-purple-50">
                <Landmark className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Salary Structures</p>
                <p className="text-xl font-bold">{structureCount === null ? "…" : structureCount}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button variant="outline" asChild className="w-full justify-start">
            <Link href="/accounts/hiring">
              <FileText className="h-4 w-4 mr-2" />
              Send Offer Letters
            </Link>
          </Button>
          <Button variant="outline" asChild className="w-full justify-start">
            <Link href="/accounts/salary-structures/new">
              <Plus className="h-4 w-4 mr-2" />
              New Salary Structure
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
