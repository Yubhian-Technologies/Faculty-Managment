"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IndianRupee, FileText, TrendingUp, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import type { OfferLetter, HiringSalaryAgreement } from "@/types";

function rupees(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export default function AccountsDashboard() {
  const user = useAuthStore((s) => s.user);
  const [stats, setStats] = useState({
    pendingSalarySetup: null as number | null,
    offerLettersIssued: null as number | null,
    avgCTC: null as number | null,
    accepted: null as number | null,
  });

  useEffect(() => {
    Promise.all([
      fetch("/api/college/salary-records")
        .then((r) => r.json() as Promise<{ records: HiringSalaryAgreement[] }>)
        .then((d) => d.records ?? []),
      fetch("/api/college/offer-letters")
        .then((r) => r.json() as Promise<{ letters: (OfferLetter & { id: string })[] }>)
        .then((d) => d.letters ?? []),
    ]).then(([salaryRecords, letters]) => {
      const issued = letters.filter((l) => l.status !== "DRAFT").length;
      const accepted = letters.filter((l) => l.status === "ACCEPTED").length;
      const avgCTC = salaryRecords.length > 0
        ? salaryRecords.reduce((s, r) => s + (r.agreedAnnual ?? 0), 0) / salaryRecords.length
        : 0;

      setStats({
        pendingSalarySetup: salaryRecords.length,
        offerLettersIssued: issued,
        avgCTC,
        accepted,
      });
    }).catch(() => {});
  }, []);

  const fmt = (n: number | null) => n === null ? "…" : String(n);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user?.name?.split(" ")[0] ?? "Accounts"}`}
        description="Salary records and offer letter management"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Salary Agreements", value: fmt(stats.pendingSalarySetup), icon: IndianRupee, color: "text-orange-600 bg-orange-50", href: "/accounts/salary" },
          { label: "Offer Letters Issued", value: fmt(stats.offerLettersIssued), icon: FileText, color: "text-green-600 bg-green-50", href: "/accounts/offers" },
          { label: "Avg Annual CTC", value: stats.avgCTC !== null && stats.avgCTC > 0 ? rupees(stats.avgCTC) : "—", icon: TrendingUp, color: "text-blue-600 bg-blue-50", href: "/accounts/salary" },
          { label: "Offers Accepted", value: fmt(stats.accepted), icon: Users, color: "text-purple-600 bg-purple-50", href: "/accounts/offers" },
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
            <CardTitle className="text-base">Workflow</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p className="flex items-center gap-2">
              <span className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">1</span>
              HR interview completes — candidate&apos;s salary expectation is recorded
            </p>
            <p className="flex items-center gap-2">
              <span className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">2</span>
              Accounts creates salary agreement (use Auto-fill to pre-populate)
            </p>
            <p className="flex items-center gap-2">
              <span className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">3</span>
              Generate offer letter for the candidate
            </p>
            <p className="flex items-center gap-2">
              <span className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">4</span>
              Mark as Sent → Accepted → Create Faculty Account
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
