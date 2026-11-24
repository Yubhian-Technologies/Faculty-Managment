"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { getJson } from "@/components/dashboard/DashboardParts";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/utils";
import type { CandidateApplication, VacancyRequest } from "@/types";

// HR > Hiring Requests: every request of the college, read only (the HOD raises them, the Principal / VP approve).
// HR adds candidates to the approved ones.

const STATUS_FILTERS = [["all", "All"], ["APPROVED", "Approved"], ["PENDING", "Awaiting Approval"], ["REJECTED", "Rejected"]] as const;

export default function HrVacanciesPage() {
  const [status, setStatus] = useState<string>("APPROVED");
  const [search, setSearch] = useState("");
  const reqs = useQuery({ queryKey: ["hr-vacancies"], queryFn: () => getJson<{ vacancyRequests: VacancyRequest[] }>("/api/college/vacancy-requests") });
  const apps = useQuery({ queryKey: ["hr-applications"], queryFn: () => getJson<{ applications: CandidateApplication[] }>("/api/college/candidate-applications") });

  const counts = useMemo(() => {
    const m = new Map<string, { total: number; shortlisted: number; selected: number }>();
    for (const a of apps.data?.applications ?? []) {
      const c = m.get(a.vacancyRequestId) ?? { total: 0, shortlisted: 0, selected: 0 };
      c.total += 1;
      if (a.isShortlisted) c.shortlisted += 1;
      if (a.status === "APPROVED") c.selected += 1;
      m.set(a.vacancyRequestId, c);
    }
    return m;
  }, [apps.data]);

  const q = search.trim().toLowerCase();
  const rows = (reqs.data?.vacancyRequests ?? [])
    .filter((v) => status === "all" || v.status === status)
    .filter((v) => !q || `${v.position} ${v.department} ${v.hodName}`.toLowerCase().includes(q))
    .sort((a, b) => a.department.localeCompare(b.department) || a.position.localeCompare(b.position));

  return (
    <div className="space-y-5">
      <PageHeader title="Hiring Requests" description="Every hiring request of the college. The HOD raises them and the Principal approves; add candidates to the approved ones." />
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search position, department or HOD..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>{STATUS_FILTERS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {reqs.isError && <p className="text-sm text-destructive">Unable to load the hiring requests. Try again; if it continues, contact the administrator.</p>}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground">
            {["Department", "Position", "Posts Open", "Raised By", "Raised On", "Status", "Candidates", "Shortlisted", "Selected", ""].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y">
            {rows.map((v) => {
              const c = counts.get(v.id) ?? { total: 0, shortlisted: 0, selected: 0 };
              return (
                <tr key={v.id}>
                  <td className="px-3 py-2.5 text-muted-foreground">{v.department}</td>
                  <td className="px-3 py-2.5 font-medium">{v.position}{v.qualification && <span className="block text-xs font-normal text-muted-foreground">{v.qualification}</span>}</td>
                  <td className="px-3 py-2.5 tabular-nums">{v.requiredCount}</td>
                  <td className="px-3 py-2.5">{v.hodName}</td>
                  <td className="px-3 py-2.5">{formatDate(v.createdAt)}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={v.status} /></td>
                  <td className="px-3 py-2.5 tabular-nums">{c.total}</td>
                  <td className="px-3 py-2.5 tabular-nums">{c.shortlisted}</td>
                  <td className="px-3 py-2.5 tabular-nums">{c.selected}</td>
                  <td className="px-3 py-2.5 text-right">
                    {v.status === "APPROVED" && v.requiredCount > 0 && <Link href={`/hr/candidates/new?vacancyId=${v.id}`} className="text-xs font-medium text-primary hover:underline">Add Candidate</Link>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {reqs.data && rows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No hiring requests here.</p>}
      </Card>
    </div>
  );
}
