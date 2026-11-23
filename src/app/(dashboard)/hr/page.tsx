"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ClipboardList, FileCheck, Hourglass, UserCheck, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Bar, Kpi, Panel, getJson } from "@/components/dashboard/DashboardParts";
import { Button } from "@/components/ui/button";
import { dmy } from "@/lib/utils";

// HR dashboard - the college's recruitment at a glance (GET /api/college/hr/overview).

interface Overview {
  kpis: { openPosts: number; openRequests: number; toScreen: number; interviewsThisWeek: number; offersPending: number; joiningThisMonth: number; avgDaysToHire: number | null; pendingRequests: number };
  stages: Record<"TO_SCREEN" | "SHORTLISTED" | "INTERVIEW" | "SELECTED" | "NOT_SUITABLE" | "REJECTED", number>;
  open: { id: string; department: string; position: string; posts: number; mode: string; approvedOn: string | null; counts: Record<string, number> }[];
  interviews: { id: string; department: string; position: string; date: string; phase: string }[];
  pendingOffers: { id: string; name: string; department: string; designation: string; status: string; joining: string | null }[];
  joining: { id: string; name: string; department: string; designation: string; date: string | null }[];
}

const STAGES: [keyof Overview["stages"], string][] = [
  ["TO_SCREEN", "To Screen"], ["SHORTLISTED", "Shortlisted"], ["INTERVIEW", "In Interview"], ["SELECTED", "Selected"], ["NOT_SUITABLE", "Not Suitable"], ["REJECTED", "Not Selected"],
];

export default function HrDashboardPage() {
  const q = useQuery({ queryKey: ["hr-overview"], queryFn: () => getJson<Overview>("/api/college/hr/overview"), staleTime: 60_000 });
  const d = q.data, k = d?.kpis, loading = q.isLoading;
  const maxStage = d ? Math.max(1, ...Object.values(d.stages)) : 1;

  return (
    <div className="space-y-5">
      <PageHeader
        title="HR Dashboard"
        description="Recruitment across the college - open posts, candidates, interviews, offers and joining."
        actions={<div className="flex gap-2"><Button asChild variant="outline"><Link href="/hr/applications">Screen Applications</Link></Button><Button asChild><Link href="/hr/candidates/new">Add Candidate</Link></Button></div>}
      />
      {q.isError && <p className="text-sm text-destructive">Unable to load the dashboard. Try again; if it continues, contact the administrator.</p>}

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={ClipboardList} label="Open Posts" loading={loading} value={k?.openPosts ?? "-"} sub={k ? `${k.openRequests} hiring request${k.openRequests === 1 ? "" : "s"}${k.pendingRequests ? ` · ${k.pendingRequests} awaiting approval` : ""}` : undefined} href="/hr/vacancies" />
        <Kpi icon={UserPlus} tone={k?.toScreen ? "crit" : undefined} label="To Screen" loading={loading} value={k?.toScreen ?? "-"} sub="applications not screened yet" href="/hr/applications" />
        <Kpi icon={CalendarClock} label="Interviews This Week" loading={loading} value={k?.interviewsThisWeek ?? "-"} href="/hr/interviews" />
        <Kpi icon={FileCheck} label="Offers Waiting" loading={loading} value={k?.offersPending ?? "-"} sub="sent, no answer yet" href="/hr/offers" />
        <Kpi icon={UserCheck} label="Joining This Month" loading={loading} value={k?.joiningThisMonth ?? "-"} href="/hr/offers" />
        <Kpi icon={Hourglass} label="Average Days to Hire" loading={loading} value={k?.avgDaysToHire ?? "-"} sub="request approved to selection" />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Open Positions" sub="approved hiring requests with posts still to fill" loading={loading} className="lg:col-span-2" href="/hr/vacancies" linkLabel="All requests">
          {d && d.open.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No open positions.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground">
                  {["Department", "Position", "Posts", "Candidates", "To Screen", "Shortlisted", "Interview", "Selected", ""].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y">
                  {(d?.open ?? []).map((v) => (
                    <tr key={v.id}>
                      <td className="px-2 py-2 text-muted-foreground">{v.department}</td>
                      <td className="px-2 py-2 font-medium">{v.position}<span className="block text-xs font-normal text-muted-foreground">{v.mode === "ONLINE" ? "Online" : "Offline"}{v.approvedOn ? ` · approved ${dmy(v.approvedOn)}` : ""}</span></td>
                      <td className="px-2 py-2 tabular-nums">{v.posts}</td>
                      <td className="px-2 py-2 tabular-nums">{v.counts.total}</td>
                      <td className="px-2 py-2 tabular-nums">{v.counts.TO_SCREEN || "-"}</td>
                      <td className="px-2 py-2 tabular-nums">{v.counts.SHORTLISTED || "-"}</td>
                      <td className="px-2 py-2 tabular-nums">{v.counts.INTERVIEW || "-"}</td>
                      <td className="px-2 py-2 tabular-nums">{v.counts.SELECTED || "-"}</td>
                      <td className="px-2 py-2 text-right"><Link href={`/hr/candidates/new?vacancyId=${v.id}`} className="text-xs font-medium text-primary hover:underline">Add Candidate</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Where Applications Stand" sub="every application of the college" loading={loading}>
          <div className="space-y-2">
            {STAGES.map(([key, label]) => <Bar key={key} label={label} wide value={d?.stages[key] ?? 0} max={maxStage} text={String(d?.stages[key] ?? 0)} />)}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Interviews This Week" loading={loading} href="/hr/interviews" linkLabel="All interviews">
          <List empty="No interviews this week." items={(d?.interviews ?? []).map((i) => ({ key: i.id, main: `${i.position} · ${i.department}`, side: dmy(i.date) }))} />
        </Panel>
        <Panel title="Offers Waiting for an Answer" loading={loading} href="/hr/offers" linkLabel="Offer letters">
          <List empty="No offers waiting." items={(d?.pendingOffers ?? []).map((o) => ({ key: o.id, main: `${o.name} · ${o.designation}`, side: o.status === "SENT" ? "Sent" : "Not sent yet" }))} />
        </Panel>
        <Panel title="Joining This Month" loading={loading}>
          <List empty="No one joining this month." items={(d?.joining ?? []).map((o) => ({ key: o.id, main: `${o.name} · ${o.designation}`, side: o.date ? dmy(o.date) : "-" }))} />
        </Panel>
      </div>
    </div>
  );
}

function List({ items, empty }: { items: { key: string; main: string; side: string }[]; empty: string }) {
  if (items.length === 0) return <p className="py-4 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
      {items.map((i) => <li key={i.key} className="flex justify-between gap-2"><span className="min-w-0 truncate">{i.main}</span><span className="shrink-0 text-xs text-muted-foreground">{i.side}</span></li>)}
    </ul>
  );
}
