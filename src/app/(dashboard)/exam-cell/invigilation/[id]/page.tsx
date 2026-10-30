"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { dayLabel } from "@/lib/midTimetable/rules";
import { AssignPanel } from "@/components/invigilation/AssignPanel";
import { DashboardPanel } from "@/components/invigilation/DashboardPanel";
import { DutiesPanel } from "@/components/invigilation/DutiesPanel";
import { FreeFacultyPanel } from "@/components/invigilation/FreeFacultyPanel";
import { ReportsPanel } from "@/components/invigilation/ReportsPanel";
import { RulesForm } from "@/components/invigilation/RulesForm";
import type { Overview } from "@/components/invigilation/model";

const TABS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "assign", label: "Assign" },
  { key: "free", label: "Free Faculty" },
  { key: "duties", label: "Duties & Publish" },
  { key: "reports", label: "Reports" },
  { key: "config", label: "Configuration" },
] as const;
type Tab = (typeof TABS)[number]["key"];

// One invigilation schedule, tab by tab.
export default function InvigilationSchedulePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const [tab, setTab] = useState<Tab>((TABS.find((t) => t.key === search.get("tab"))?.key) ?? "dashboard");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [extra, setExtra] = useState<{ approvers: { uid: string; name: string }[]; mids: { id: string; label: string }[] }>({ approvers: [], mids: [] });
  const [error, setError] = useState("");
  const [slotKey, setSlotKey] = useState<string | undefined>();
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/college/invigilation/schedules/${id}`, { cache: "no-store" })
      .then(async (r) => { const d = (await r.json()) as Overview & { error?: string }; if (!r.ok) throw new Error(d.error ?? "Failed to load"); setOverview(d); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [id]);
  useEffect(() => {
    load();
    fetch("/api/college/invigilation/schedules", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ approvers?: { uid: string; name: string }[]; mids?: { id: string; label: string }[] }>)
      .then((d) => setExtra({ approvers: d.approvers ?? [], mids: d.mids ?? [] }))
      .catch(() => undefined);
  }, [load]);

  const departments = useMemo(() => [...new Set((overview?.faculty ?? []).map((f) => f.department).filter(Boolean))].sort(), [overview]);
  const openSlot = (k: string) => { setSlotKey(k); setTab("assign"); };

  async function remove() {
    const res = await fetch(`/api/college/invigilation/schedules/${id}`, { method: "DELETE" });
    const data = (await res.json()) as { error?: string };
    setDeleting(false);
    if (!res.ok) return toast({ variant: "destructive", title: data.error ?? "Could not delete" });
    router.push("/exam-cell/invigilation");
  }

  if (error) return <div className="space-y-4"><PageHeader title="Invigilation" /><p className="text-sm text-destructive">{error}</p></div>;
  if (!overview) return <div className="space-y-4"><div className="h-10 w-64 animate-pulse rounded bg-muted/40" /><div className="h-64 animate-pulse rounded-lg bg-muted/30" /></div>;
  const s = overview.schedule;
  const days = s.days.length ? (s.days.length === 1 ? dayLabel(s.days[0]) : `${dayLabel(s.days[0])} - ${dayLabel(s.days[s.days.length - 1])}`) : "";

  return (
    <div className="space-y-5">
      <PageHeader
        title={s.name}
        description={days}
        actions={
          <>
            <Button variant="outline" asChild><Link href="/exam-cell/invigilation"><ArrowLeft className="mr-1 h-4 w-4" />All schedules</Link></Button>
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleting(true)}><Trash2 className="mr-1 h-4 w-4" />Delete</Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        {s.status === "CLOSED" && <Badge variant="outline">Closed - read only</Badge>}
        <div role="tablist" className="flex flex-wrap gap-1 rounded-lg border bg-muted/30 p-1">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} type="button" onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === t.key ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{t.label}</button>
          ))}
        </div>
      </div>
      {tab === "dashboard" && <DashboardPanel overview={overview} onOpenSlot={openSlot} />}
      {tab === "assign" && <AssignPanel key={slotKey ?? "x"} overview={overview} onChanged={load} initialSlot={slotKey} />}
      {tab === "free" && <FreeFacultyPanel overview={overview} />}
      {tab === "duties" && <DutiesPanel overview={overview} onChanged={load} onOpenSlot={openSlot} />}
      {tab === "reports" && <ReportsPanel overview={overview} />}
      {tab === "config" && <RulesForm overview={overview} approvers={extra.approvers} mids={extra.mids} departments={departments} onSaved={load} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this schedule?"
        description="Removes the schedule and its draft duties. Refused once any duty was published - close it instead (Configuration > Status)."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void remove()}
      />
    </div>
  );
}
