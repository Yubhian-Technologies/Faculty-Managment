"use client";

import { useEffect, useState } from "react";
import { FileDown, FileSpreadsheet, TrendingUp, Wallet, IndianRupee, ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DashboardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatCurrency } from "@/lib/utils";
import { auth } from "@/lib/firebase/client";
import { exportFinanceReportExcel } from "@/lib/finance/exportExcel";
import type { FinanceReportPeriod, FinanceReportSummary } from "@/types";

function periodRange(period: FinanceReportPeriod): { from: Date; to: Date; label: string } {
  const now = new Date();
  if (period === "MONTHLY") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    return { from, to, label: from.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) };
  }
  if (period === "QUARTERLY") {
    const q = Math.floor(now.getMonth() / 3);
    const from = new Date(now.getFullYear(), q * 3, 1);
    const to = new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59);
    return { from, to, label: `Q${q + 1} ${now.getFullYear()}` };
  }
  const from = new Date(now.getFullYear(), 0, 1);
  const to = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
  return { from, to, label: `${now.getFullYear()}` };
}

export default function FinanceReportsPage() {
  const [period, setPeriod] = useState<FinanceReportPeriod>("MONTHLY");
  const [report, setReport] = useState<FinanceReportSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [collegeName, setCollegeName] = useState("");
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  useEffect(() => {
    collegeFetch("/api/college/info").then((r) => r.json() as Promise<{ name: string }>).then((d) => setCollegeName(d.name)).catch(() => {});
  }, []);

  useEffect(() => {
    setIsLoading(true);
    const { from, to, label } = periodRange(period);
    const params = new URLSearchParams({
      period, periodLabel: label, from: from.toISOString(), to: to.toISOString(),
    });
    collegeFetch(`/api/college/finance-reports?${params.toString()}`)
      .then((r) => r.json() as Promise<FinanceReportSummary>)
      .then(setReport)
      .catch(() => toast({ variant: "destructive", title: "Failed to load report" }))
      .finally(() => setIsLoading(false));
  }, [period]);

  async function handleExportPdf() {
    if (!report) return;
    setIsExportingPdf(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");
      const res = await fetch("/api/pdf/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: "FINANCE_REPORT", data: { collegeName, ...report } }),
      });
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `financial-report-${period.toLowerCase()}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to export PDF", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsExportingPdf(false);
    }
  }

  async function handleExportExcel() {
    if (!report) return;
    setIsExportingExcel(true);
    try {
      await exportFinanceReportExcel(report);
    } catch {
      toast({ variant: "destructive", title: "Failed to export Excel" });
    } finally {
      setIsExportingExcel(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financial Reports"
        description="Monthly, quarterly, and annual budget utilization and expenditure reports"
        actions={
          <div className="flex items-center gap-2">
            <Select value={period} onValueChange={(v) => setPeriod(v as FinanceReportPeriod)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MONTHLY">Monthly</SelectItem>
                <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                <SelectItem value="ANNUAL">Annual</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => void handleExportPdf()} loading={isExportingPdf} disabled={!report}>
              <FileDown className="h-4 w-4 mr-1" />
              PDF
            </Button>
            <Button variant="outline" onClick={() => void handleExportExcel()} loading={isExportingExcel} disabled={!report}>
              <FileSpreadsheet className="h-4 w-4 mr-1" />
              Excel
            </Button>
          </div>
        }
      />

      {isLoading || !report ? (
        <DashboardSkeleton />
      ) : (
        <>
          <p className="text-sm text-muted-foreground -mt-4">{report.periodLabel}</p>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              { label: "Total Allocated", value: formatCurrency(report.totalAllocated), icon: Wallet, color: "text-blue-600 bg-blue-50" },
              { label: "Total Utilized", value: formatCurrency(report.totalUtilized), icon: TrendingUp, color: "text-green-600 bg-green-50" },
              { label: "Total Payments", value: formatCurrency(report.totalPayments), icon: IndianRupee, color: "text-purple-600 bg-purple-50" },
              { label: "Pending Approvals", value: String(report.pendingApprovals), icon: ClipboardCheck, color: "text-orange-600 bg-orange-50" },
            ].map((stat) => (
              <Card key={stat.label}>
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
            ))}
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Department-wise Utilization</CardTitle></CardHeader>
            <CardContent>
              {Object.keys(report.byDepartment).length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No budget activity in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">Department</th>
                        <th className="py-2 pr-4 font-medium">Allocated</th>
                        <th className="py-2 pr-4 font-medium">Utilized</th>
                        <th className="py-2 font-medium">Remaining</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {Object.entries(report.byDepartment).map(([dept, v]) => (
                        <tr key={dept}>
                          <td className="py-2 pr-4 font-medium">{dept}</td>
                          <td className="py-2 pr-4">{formatCurrency(v.allocated)}</td>
                          <td className="py-2 pr-4">{formatCurrency(v.utilized)}</td>
                          <td className="py-2">{formatCurrency(v.allocated - v.utilized)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
