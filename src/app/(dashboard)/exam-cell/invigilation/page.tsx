"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/useToast";
import { dayLabel } from "@/lib/midTimetable/rules";
import type { InvigilationSchedule } from "@/types/invigilation";

interface Mid { id: string; label: string; days: string[]; branches: number }

// Exam Cell > Invigilation: one schedule per Mid exam (one or more Mid
// timetables written together). Its duties, rules and reports live on the
// schedule's own page.
export default function InvigilationPage() {
  const router = useRouter();
  const [schedules, setSchedules] = useState<InvigilationSchedule[]>([]);
  const [mids, setMids] = useState<Mid[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/college/invigilation/schedules", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ schedules?: InvigilationSchedule[]; mids?: Mid[]; error?: string }>)
      .then((d) => { setSchedules(d.schedules ?? []); setMids(d.mids ?? []); })
      .catch(() => toast({ variant: "destructive", title: "Failed to load invigilation schedules" }))
      .finally(() => setLoading(false));
  }, []);

  async function create() {
    setSaving(true);
    try {
      const res = await fetch("/api/college/invigilation/schedules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, midPlanIds: picked }) });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Failed to create");
      router.push(`/exam-cell/invigilation/${data.id}?tab=config`);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to create" });
    } finally {
      setSaving(false);
    }
  }

  const range = (days: string[]) => (days.length ? (days.length === 1 ? dayLabel(days[0]) : `${dayLabel(days[0])} - ${dayLabel(days[days.length - 1])}`) : "No exam days yet");

  return (
    <div className="space-y-6">
      <PageHeader title="Invigilation" description="Exam duties for faculty - invigilators per room, relievers and the special squad per session - checked against timetables, leave, subjects and workload." />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New schedule</CardTitle>
          <CardDescription>Pick the Mid timetable(s) written together. Rooms come from their Exam Seating plans; duties are worked out per exam session.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {mids.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">No Mid timetable has branches saved yet - build one in Mid Timetable first.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {mids.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm hover:bg-muted/40">
                  <Checkbox checked={picked.includes(m.id)} onCheckedChange={(v) => setPicked((p) => (v ? [...p, m.id] : p.filter((x) => x !== m.id)))} className="mt-0.5" />
                  <span>
                    <span className="font-medium">{m.label}</span>
                    <span className="block text-xs text-muted-foreground">{range(m.days)} · {m.branches} branch{m.branches === 1 ? "" : "es"}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1 space-y-1.5">
              <Label htmlFor="inv-name">Name (optional)</Label>
              <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mid-1 November 2026" />
            </div>
            <Button onClick={() => void create()} loading={saving} disabled={picked.length === 0}><Plus className="mr-1 h-4 w-4" />Create schedule</Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="h-24 animate-pulse rounded-lg border bg-muted/30" />
      ) : schedules.length === 0 ? (
        <EmptyState title="No invigilation schedules yet" description="Create one above for a Mid exam." />
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {schedules.map((s) => (
              <Link key={s.id} href={`/exam-cell/invigilation/${s.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-muted/40">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{range(s.days)} · {s.publishedSessions?.length ?? 0} session(s) published</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={s.status === "ACTIVE" ? "approved" : "outline"}>{s.status === "ACTIVE" ? "Active" : "Closed"}</Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
