"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { getJson } from "@/components/dashboard/DashboardParts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { cn, formatDate } from "@/lib/utils";
import type { Candidate, CandidateApplication } from "@/types";

// HR > Applications: screening. Each application (a candidate attached to a hiring request - from the careers page,
// an import, or added by hand) is Shortlisted for the HOD's interview, or set aside as Not Suitable with a reason.
// The Principal's decision (`status`) is never touched here.

type Tab = "screen" | "shortlisted" | "notSuitable" | "all";
const TABS: [Tab, string][] = [["screen", "To Screen"], ["shortlisted", "Shortlisted"], ["notSuitable", "Not Suitable"], ["all", "All"]];
const SOURCE: Record<string, string> = { WALK_IN: "Walk-in", CAREERS_PAGE: "Careers Page", ADVERTISEMENT: "Advertisement", REFERRAL: "Referral" };

const decided = (a: CandidateApplication) => a.status === "APPROVED" || a.status === "REJECTED";
const tabOf = (a: CandidateApplication): Tab =>
  a.screening?.result === "NOT_SUITABLE" ? "notSuitable" : a.isShortlisted || a.batchId ? "shortlisted" : "screen";

export default function HrApplicationsPage() {
  const [tab, setTab] = useState<Tab>("screen");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<CandidateApplication | null>(null);
  const [reason, setReason] = useState("");
  const apps = useQuery({ queryKey: ["hr-applications"], queryFn: () => getJson<{ applications: CandidateApplication[] }>("/api/college/candidate-applications") });
  const cands = useQuery({ queryKey: ["hr-candidates"], queryFn: () => getJson<{ candidates: Candidate[] }>("/api/college/candidates") });
  const byId = useMemo(() => new Map((cands.data?.candidates ?? []).map((c) => [c.id, c])), [cands.data]);

  const open = (apps.data?.applications ?? []).filter((a) => !decided(a));
  const counts = { screen: 0, shortlisted: 0, notSuitable: 0, all: open.length } as Record<Tab, number>;
  for (const a of open) counts[tabOf(a)] += 1;
  const q = search.trim().toLowerCase();
  const rows = open
    .filter((a) => tab === "all" || tabOf(a) === tab)
    .filter((a) => { const c = byId.get(a.candidateId); return !q || `${c?.name ?? ""} ${c?.phone ?? ""} ${a.position} ${a.department}`.toLowerCase().includes(q); })
    .sort((a, b) => String(a.department).localeCompare(b.department) || String(a.position).localeCompare(b.position));

  const screen = async (a: CandidateApplication, screening: { result: "SHORTLISTED" | "NOT_SUITABLE"; reason?: string } | null) => {
    setBusy(a.id);
    try {
      const res = await fetch(`/api/college/candidate-applications/${a.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ screening }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Unable to save the screening.");
      toast({ variant: "success", title: screening ? (screening.result === "SHORTLISTED" ? "Candidate shortlisted." : "Marked not suitable.") : "Screening cleared." });
      await apps.refetch();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to save the screening." });
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Applications" description="Screen every application before the interview: shortlist it for the HOD, or set it aside as not suitable with a reason. The Principal still makes the final selection." />
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium", tab === k ? "border-foreground bg-foreground text-background" : "bg-card hover:border-primary")}>
            {l} <span className="opacity-70">{counts[k]}</span>
          </button>
        ))}
        <Input placeholder="Search name, mobile, position..." value={search} onChange={(e) => setSearch(e.target.value)} className="ml-auto max-w-xs" />
      </div>
      {apps.isError && <p className="text-sm text-destructive">Unable to load the applications. Try again; if it continues, contact the administrator.</p>}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground">
            {["Candidate", "Applied For", "Source", "Applied On", "Resume", "Screening", ""].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y">
            {rows.map((a) => {
              const c = byId.get(a.candidateId);
              const t = tabOf(a);
              return (
                <tr key={a.id}>
                  <td className="px-3 py-2.5"><Link href={`/hr/candidates/${a.candidateId}`} className="font-medium hover:underline">{c?.name ?? "-"}</Link><span className="block text-xs tabular-nums text-muted-foreground">{c?.phone}</span></td>
                  <td className="px-3 py-2.5">{a.position}<span className="block text-xs text-muted-foreground">{a.department}</span></td>
                  <td className="px-3 py-2.5">{SOURCE[c?.source ?? ""] ?? c?.source ?? "-"}</td>
                  <td className="px-3 py-2.5">{formatDate(a.createdAt)}</td>
                  <td className="px-3 py-2.5">{c?.resumeUrl ? <a href={c.resumeUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">Open<ExternalLink className="h-3 w-3" /></a> : <span className="text-xs text-muted-foreground">None</span>}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {a.batchId ? <span>In an interview batch</span>
                      : t === "notSuitable" ? <span className="text-amber-800 dark:text-amber-300">Not suitable: {a.screening?.reason}</span>
                      : t === "shortlisted" ? <span className="text-emerald-700 dark:text-emerald-400">Shortlisted{a.screening?.byName ? ` by ${a.screening.byName}` : ""}</span>
                      : <span className="text-muted-foreground">Not screened</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {!a.batchId && (
                      <div className="flex justify-end gap-1.5">
                        {t !== "shortlisted" && <Button size="sm" disabled={busy === a.id} onClick={() => void screen(a, { result: "SHORTLISTED" })}>Shortlist</Button>}
                        {t !== "notSuitable" && <Button size="sm" variant="outline" disabled={busy === a.id} onClick={() => { setReason(""); setReasonFor(a); }}>Not Suitable</Button>}
                        {t !== "screen" && <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => void screen(a, null)}>Undo</Button>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {apps.data && rows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No applications here.</p>}
      </Card>

      <Dialog open={!!reasonFor} onOpenChange={(o) => { if (!o) setReasonFor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Not Suitable</DialogTitle>
            <DialogDescription>{reasonFor ? `${byId.get(reasonFor.candidateId)?.name ?? "This candidate"} for ${reasonFor.position} (${reasonFor.department}). The reason is kept with the application.` : ""}</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: does not have the required qualification." rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonFor(null)}>Cancel</Button>
            <Button disabled={!reason.trim() || busy === reasonFor?.id} onClick={() => { const a = reasonFor!; setReasonFor(null); void screen(a, { result: "NOT_SUITABLE", reason }); }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
