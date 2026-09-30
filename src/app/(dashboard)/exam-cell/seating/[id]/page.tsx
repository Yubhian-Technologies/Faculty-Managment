"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Printer, Save, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { moveStudent, rollRangeBySection } from "@/lib/exams/seatingAllocator";
import type { ExamSeatingPlan } from "@/types/examSeating";

// Review of an automatic allotment: every room with its roll-number ranges,
// each student movable to another room (capacity enforced), anyone unplaced
// listed on top, then save / publish / print / CSV.
export default function SeatingPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [plan, setPlan] = useState<ExamSeatingPlan | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    fetch(`/api/college/exam-seating/${id}`)
      .then((r) => r.json() as Promise<{ plan?: ExamSeatingPlan }>)
      .then((d) => setPlan(d.plan ?? null))
      .catch(() => toast({ variant: "destructive", title: "Failed to load the plan" }));
  }, [id]);

  if (!plan) return <div className="h-40 rounded-lg border bg-muted/30 animate-pulse" />;

  const published = plan.status === "PUBLISHED";

  function move(studentId: string, target: string) {
    const next = moveStudent(plan!, studentId, target);
    if (!next) { toast({ variant: "destructive", title: "That room is full" }); return; }
    setPlan({ ...plan!, ...next });
    setDirty(true);
  }

  async function patch(body: Record<string, unknown>, okMessage: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/college/exam-seating/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      toast({ variant: "success", title: okMessage });
      setDirty(false);
      return true;
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const edits = () => ({ rooms: plan.rooms, unplaced: plan.unplaced });

  async function publish() {
    if (await patch({ ...edits(), status: "PUBLISHED" }, "Seating plan published")) setPlan({ ...plan!, status: "PUBLISHED" });
  }

  async function remove() {
    await fetch(`/api/college/exam-seating/${id}`, { method: "DELETE" });
    router.push("/exam-cell/seating");
  }

  function downloadCsv() {
    const lines = [["Room", "Block", "Floor", "Seat", "Roll Number", "Name", "Section"]];
    for (const r of plan!.rooms) {
      r.students.forEach((s, i) => lines.push([r.name, r.block, String(r.floor), String(i + 1), s.rollNumber, s.name, s.sectionLabel]));
    }
    const csv = lines.map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${plan!.name.replace(/[^a-z0-9]+/gi, "-")}-seating.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const usedRooms = plan.rooms.filter((r) => r.students.length > 0);

  return (
    <div className="space-y-6">
      <div className="print:hidden space-y-4">
        <Link href="/exam-cell/seating" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All plans
        </Link>
        <PageHeader
          title={plan.name}
          description={`${plan.rooms.reduce((n, r) => n + r.students.length, 0)} students seated in ${usedRooms.length} rooms`}
          actions={
            <>
              <Badge variant={published ? "approved" : "pending"}>{published ? "Published" : "Draft"}</Badge>
              <Button size="sm" variant="outline" onClick={downloadCsv}><Download className="h-4 w-4 mr-1" /> CSV</Button>
              <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" /> Print</Button>
              <Button size="sm" variant="outline" disabled={!dirty} loading={busy} onClick={() => void patch(edits(), "Changes saved")}>
                <Save className="h-4 w-4 mr-1" /> Save
              </Button>
              {!published && (
                <Button size="sm" disabled={plan.unplaced.length > 0} loading={busy} onClick={() => void publish()}>
                  <Send className="h-4 w-4 mr-1" /> Publish
                </Button>
              )}
              <Button size="icon" variant="ghost" aria-label="Delete plan" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" /></Button>
            </>
          }
        />

        {plan.unplaced.length > 0 && (
          <Card className="border-destructive/50">
            <CardContent className="p-4 space-y-2">
              <p className="text-sm font-medium text-destructive">{plan.unplaced.length} student(s) have no seat - move them into a room with space (or add a room by building a new plan).</p>
              {plan.unplaced.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{s.rollNumber} · {s.name} <span className="text-xs text-muted-foreground">{s.sectionLabel}</span></span>
                  <MoveSelect plan={plan} current="UNPLACED" onMove={(t) => move(s.id, t)} />
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {usedRooms.map((room) => (
        <Card key={room.roomId} className="print:break-after-page print:shadow-none print:border-0">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-lg font-semibold">Room {room.name}</p>
                <p className="text-xs text-muted-foreground">Block {room.block} · Floor {room.floor} · {plan.name}</p>
              </div>
              <p className="text-sm text-muted-foreground">{room.students.length} / {room.capacity} seats</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {rollRangeBySection(room.students).map((g) => (
                <Badge key={g.sectionLabel} variant="outline" className="font-normal">
                  {g.sectionLabel}: {g.from} – {g.to} ({g.count})
                </Badge>
              ))}
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b">
                <tr><th className="py-1.5 w-12">Seat</th><th>Roll No.</th><th>Name</th><th>Section</th><th className="print:hidden text-right">Move to</th></tr>
              </thead>
              <tbody>
                {room.students.map((s, i) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-1.5">{i + 1}</td>
                    <td>{s.rollNumber}</td>
                    <td>{s.name}</td>
                    <td className="text-xs text-muted-foreground">{s.sectionLabel}</td>
                    <td className="print:hidden text-right"><MoveSelect plan={plan} current={room.roomId} onMove={(t) => move(s.id, t)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this seating plan?"
        description="This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function MoveSelect({ plan, current, onMove }: { plan: ExamSeatingPlan; current: string; onMove: (target: string) => void }) {
  return (
    <Select value="" onValueChange={onMove}>
      <SelectTrigger className="h-7 w-36 text-xs"><SelectValue placeholder="Move…" /></SelectTrigger>
      <SelectContent>
        {plan.rooms.filter((r) => r.roomId !== current).map((r) => (
          <SelectItem key={r.roomId} value={r.roomId} disabled={r.students.length >= r.capacity}>
            {r.name} ({r.students.length}/{r.capacity})
          </SelectItem>
        ))}
        {current !== "UNPLACED" && <SelectItem value="UNPLACED">Unplaced</SelectItem>}
      </SelectContent>
    </Select>
  );
}
