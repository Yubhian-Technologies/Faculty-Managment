"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { useReadOnlyAccess } from "@/hooks/useReadOnlyAccess";
import { dayLabel, timeLabel } from "@/lib/midTimetable/rules";
import { DUTY_CATEGORY_LABELS, type DutyCategory, type DutyStatus } from "@/types/invigilation";

interface MyDuty { id: string; date: string; from: string; to: string; category: DutyCategory; room: string; status: DutyStatus }

const STATUS: Record<DutyStatus, { label: string; tone: "pending" | "approved" | "secondary" | "rejected" | "outline" }> = {
  DRAFT: { label: "Draft", tone: "outline" },
  PUBLISHED: { label: "New - please acknowledge", tone: "pending" },
  ACKNOWLEDGED: { label: "Acknowledged", tone: "secondary" },
  COMPLETED: { label: "Done", tone: "approved" },
  CANCELLED: { label: "Cancelled", tone: "rejected" },
  REASSIGNED: { label: "Given to someone else", tone: "rejected" },
};

// Faculty: the exam duties the Exam Cell has published for me (one exam at a time).
export default function MyInvigilationPage() {
  const [duties, setDuties] = useState<MyDuty[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const readOnly = useReadOnlyAccess();

  function load() {
    fetch("/api/college/invigilation/my", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ duties?: MyDuty[] }>)
      .then((d) => setDuties(d.duties ?? []))
      .catch(() => { setDuties([]); toast({ variant: "destructive", title: "Failed to load your duties" }); });
  }
  useEffect(load, []);

  async function acknowledge(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/college/invigilation/duties/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "acknowledge" }) });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not acknowledge");
      toast({ variant: "success", title: "Acknowledged" });
      load();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not acknowledge" });
    } finally {
      setBusy(null);
    }
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const upcoming = (duties ?? []).filter((d) => d.date >= today && d.status !== "CANCELLED" && d.status !== "REASSIGNED");
  const rest = (duties ?? []).filter((d) => !upcoming.includes(d));

  const list = (items: MyDuty[]) => (
    <Card>
      <CardContent className="divide-y p-0">
        {items.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">{dayLabel(d.date)} · {timeLabel(d.from)} - {timeLabel(d.to)}</p>
              <p className="text-sm text-muted-foreground">{DUTY_CATEGORY_LABELS[d.category]}{d.room ? ` · ${d.room}` : ""}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
              {d.status === "PUBLISHED" && !readOnly && <Button size="sm" loading={busy === d.id} onClick={() => void acknowledge(d.id)}><CheckCircle2 className="mr-1 h-4 w-4" />Acknowledge</Button>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="My Invigilation Duties" description="Exam duties the Exam Cell has given you. Acknowledge each one so the Exam Cell knows you have seen it." />
      {duties === null ? <div className="h-32 animate-pulse rounded-lg border bg-muted/30" /> : duties.length === 0 ? (
        <EmptyState title="No exam duties" description="Duties appear here once the Exam Cell publishes them." />
      ) : (
        <>
          {upcoming.length > 0 && <section className="space-y-2"><h2 className="text-sm font-medium text-muted-foreground">Upcoming</h2>{list(upcoming)}</section>}
          {rest.length > 0 && <section className="space-y-2"><h2 className="text-sm font-medium text-muted-foreground">Past and changed</h2>{list(rest)}</section>}
        </>
      )}
    </div>
  );
}
