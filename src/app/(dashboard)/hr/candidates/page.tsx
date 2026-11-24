"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { getJson } from "@/components/dashboard/DashboardParts";
import { CandidateImportDialog } from "@/components/hiring/CandidateImportDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { Candidate, CandidateApplication } from "@/types";

// HR > Candidates: the college's whole candidate pool (every department), with Add Candidate and Excel import.

const SOURCE: Record<string, string> = { WALK_IN: "Walk-in", CAREERS_PAGE: "Careers Page", ADVERTISEMENT: "Advertisement", REFERRAL: "Referral" };

export default function HrCandidatesPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const cands = useQuery({ queryKey: ["hr-candidates"], queryFn: () => getJson<{ candidates: Candidate[] }>("/api/college/candidates") });
  const apps = useQuery({ queryKey: ["hr-applications"], queryFn: () => getJson<{ applications: CandidateApplication[] }>("/api/college/candidate-applications") });
  const appsBy = useMemo(() => {
    const m = new Map<string, CandidateApplication[]>();
    for (const a of apps.data?.applications ?? []) m.set(a.candidateId, [...(m.get(a.candidateId) ?? []), a]);
    return m;
  }, [apps.data]);

  const q = search.trim().toLowerCase();
  const rows = (cands.data?.candidates ?? []).filter((c) => !q || `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(q));
  const refresh = () => { void cands.refetch(); void apps.refetch(); };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Candidates"
        description="Every candidate of the college. Add one, or import many from Excel; attach them to an approved hiring request."
        actions={<div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}><FileSpreadsheet className="mr-1.5 h-4 w-4" />Import from Excel</Button>
          <Button asChild><Link href="/hr/candidates/new"><Plus className="mr-1.5 h-4 w-4" />Add Candidate</Link></Button>
        </div>}
      />
      <Input placeholder="Search name, email or mobile..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
      {cands.isError && <p className="text-sm text-destructive">Unable to load the candidates. Try again; if it continues, contact the administrator.</p>}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground">
            {["Name", "Mobile", "Email", "Source", "Applied For", "Added By", "Added On"].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y">
            {rows.map((c) => {
              const list = appsBy.get(c.id) ?? [];
              return (
                <tr key={c.id} className="cursor-pointer hover:bg-muted/40" onClick={() => router.push(`/hr/candidates/${c.id}`)}>
                  <td className="px-3 py-2.5 font-medium">{c.name}</td>
                  <td className="px-3 py-2.5 tabular-nums">{c.phone}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{c.email}</td>
                  <td className="px-3 py-2.5">{SOURCE[c.source] ?? c.source}</td>
                  <td className="px-3 py-2.5">
                    {list.length === 0 ? <span className="text-xs text-muted-foreground">Not attached</span> : (
                      <div className="flex flex-wrap gap-1">{list.map((a) => (
                        <Badge key={a.id} variant="outline" className="font-normal">{a.position} · {a.department}{a.status === "APPROVED" ? " · Selected" : a.screening?.result === "NOT_SUITABLE" ? " · Not suitable" : a.isShortlisted ? " · Shortlisted" : ""}</Badge>
                      ))}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">{c.addedByName}</td>
                  <td className="px-3 py-2.5">{formatDate(c.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {cands.data && rows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No candidates yet.</p>}
      </Card>
      <CandidateImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={refresh} />
    </div>
  );
}
