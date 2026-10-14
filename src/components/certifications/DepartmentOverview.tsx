"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { toast } from "@/hooks/useToast";
import type { CertificateSectionOverviewRow } from "@/types";
import { getDepartmentOverview } from "./api";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

// Every certificate request filed by a student in the HOD's own department,
// bucketed per section - a standing status board, distinct from the Inbox
// above it (which only shows what's waiting on THIS HOD's own decision
// right now).
export function DepartmentOverview() {
  const [rows, setRows] = useState<CertificateSectionOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getDepartmentOverview());
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't load the department overview" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<ClipboardList className="h-6 w-6" />}
          title="No certificate requests yet"
          description="Once students in your department request a certificate, their section-wise status will show up here."
        />
      </Card>
    );
  }

  const totalInProgress = rows.reduce((sum, r) => sum + r.inProgress, 0);
  const totalCompleted = rows.reduce((sum, r) => sum + r.completed, 0);

  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h3 className="text-sm font-semibold">Certificate Requests by Section</h3>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span><span className="font-semibold text-amber-600">{totalInProgress}</span> in progress</span>
            <span><span className="font-semibold text-emerald-600">{totalCompleted}</span> completed</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Year</th>
                <th className="py-2 pr-4 font-medium">Section</th>
                <th className="py-2 pr-4 font-medium text-right">In Progress</th>
                <th className="py-2 font-medium text-right">Completed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.department}-${r.year}-${r.section}`} className="border-b last:border-0">
                  <td className="py-2.5 pr-4">{ordinalYear(r.year)}</td>
                  <td className="py-2.5 pr-4">{r.section || "Unassigned"}</td>
                  <td className="py-2.5 pr-4 text-right font-medium text-amber-600">{r.inProgress}</td>
                  <td className="py-2.5 text-right font-medium text-emerald-600">{r.completed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
