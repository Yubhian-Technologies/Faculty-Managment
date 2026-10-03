"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Wand2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { availableBenches, divideIntoGroups } from "@/lib/exams/seatingLayers";
import type { ExamSeatingPlan, SeatingSectionRef, SeatingStudent } from "@/types/examSeating";

interface GroupRow { roomId: string; size: number }

// Allot one section into a layered plan: the section's (not yet seated)
// students are divided into groups by the benches of the rooms chosen, in roll
// order, and each group is sent to a room. Rooms already holding another
// branch use their next bench layer; a room with no free layer for this
// branch is not offered.
export function AllotSectionPanel({ plan, onAllotted }: { plan: ExamSeatingPlan; onAllotted: () => void }) {
  const [sections, setSections] = useState<SeatingSectionRef[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [students, setStudents] = useState<SeatingStudent[]>([]);
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/college/exam-seating/sections")
      .then((r) => r.json() as Promise<{ sections?: SeatingSectionRef[] }>)
      .then((d) => setSections(d.sections ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load sections" }));
  }, []);

  const section = sections.find((s) => s.id === sectionId);
  const seated = useMemo(() => new Set(plan.rooms.flatMap((r) => r.students.map((s) => s.id))), [plan.rooms]);

  useEffect(() => {
    setRows([]);
    if (!sectionId) { setStudents([]); return; }
    let cancelled = false;
    fetch(`/api/college/exam-seating/sections?sectionId=${encodeURIComponent(sectionId)}`)
      .then((r) => r.json() as Promise<{ students?: SeatingStudent[] }>)
      .then((d) => { if (!cancelled) setStudents(d.students ?? []); })
      .catch(() => toast({ variant: "destructive", title: "Failed to load students" }));
    return () => { cancelled = true; };
  }, [sectionId]);

  const todo = useMemo(() => students.filter((s) => !seated.has(s.id)), [students, seated]);

  const deptBySection = useMemo(() => {
    const m = new Map(plan.sections.map((s) => [s.id, s.department]));
    if (section) m.set(section.id, section.department);
    return m;
  }, [plan.sections, section]);
  const deptOf = (id: string) => deptBySection.get(id) ?? "";
  const dept = section?.department ?? "";

  const avail = (roomId: string) => {
    const room = plan.rooms.find((r) => r.roomId === roomId);
    return room && dept ? availableBenches(room, dept, deptOf) : 0;
  };
  const offeredRooms = plan.rooms.filter((r) => avail(r.roomId) > 0);

  function autoDivide() {
    let left = todo.length;
    const next: GroupRow[] = [];
    for (const r of offeredRooms) {
      if (left <= 0) break;
      const size = Math.min(avail(r.roomId), left);
      next.push({ roomId: r.roomId, size });
      left -= size;
    }
    setRows(next);
  }

  const assigned = rows.reduce((n, r) => n + r.size, 0);
  const remaining = todo.length - assigned;
  const duplicateRoom = new Set(rows.map((r) => r.roomId)).size !== rows.length;
  const overfull = rows.some((r) => r.size > avail(r.roomId) || r.size < 1);
  const { groups } = divideIntoGroups(todo, rows.map((r) => r.size));

  async function allot() {
    setBusy(true);
    try {
      const res = await fetch(`/api/college/exam-seating/${plan.id}/allot`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId,
          groups: rows.map((r, i) => ({ roomId: r.roomId, studentIds: groups[i].map((s) => s.id) })),
        }),
      });
      const data = (await res.json()) as { seated?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to allot");
      toast({ variant: "success", title: `${data.seated} student(s) seated` });
      setRows([]);
      onAllotted();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to allot" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="print:hidden">
      <CardHeader><CardTitle className="text-base">Allot a section</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-md space-y-1.5">
          <Label>Section</Label>
          <Select value={sectionId} onValueChange={setSectionId}>
            <SelectTrigger><SelectValue placeholder="Pick a section" /></SelectTrigger>
            <SelectContent>
              {sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {section && (
          <>
            <p className="text-sm text-muted-foreground">
              {todo.length} student(s) to seat{students.length !== todo.length ? ` (${students.length - todo.length} already seated)` : ""}.
              {" "}Group size follows each room&rsquo;s benches - edit a size or room if needed.
            </p>

            <div className="space-y-2">
              {rows.map((row, i) => {
                const g = groups[i] ?? [];
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <span className="w-16 text-sm font-medium">Group {i + 1}</span>
                    <Select value={row.roomId} onValueChange={(v) => setRows((l) => l.map((x, j) => (j === i ? { ...x, roomId: v } : x)))}>
                      <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Room" /></SelectTrigger>
                      <SelectContent>
                        {offeredRooms.map((r) => (
                          <SelectItem key={r.roomId} value={r.roomId}>{r.name} · {avail(r.roomId)} free benches</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number" min={1} className="h-8 w-20" value={row.size}
                      onChange={(e) => setRows((l) => l.map((x, j) => (j === i ? { ...x, size: Number(e.target.value) } : x)))}
                    />
                    <span className="text-xs text-muted-foreground">
                      {g.length > 0 ? `${g[0].rollNumber} – ${g[g.length - 1].rollNumber}` : "no students"}
                    </span>
                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Remove group" onClick={() => setRows((l) => l.filter((_, j) => j !== i))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={autoDivide} disabled={todo.length === 0}>
                <Wand2 className="h-4 w-4 mr-1" /> Auto-divide
              </Button>
              <Button
                size="sm" variant="outline" disabled={offeredRooms.length === 0 || remaining <= 0}
                onClick={() => setRows((l) => [...l, { roomId: offeredRooms.find((r) => !l.some((x) => x.roomId === r.roomId))?.roomId ?? "", size: 1 }])}
              >
                <Plus className="h-4 w-4 mr-1" /> Add group
              </Button>
              <Button size="sm" loading={busy} disabled={rows.length === 0 || assigned === 0 || duplicateRoom || overfull || remaining < 0 || rows.some((r) => !r.roomId)} onClick={() => void allot()}>
                Allot
              </Button>
              {rows.length > 0 && (
                <span className={`text-xs ${remaining !== 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                  {remaining > 0 ? `${remaining} still without a group` : remaining < 0 ? `${-remaining} too many` : "All students grouped"}
                </span>
              )}
              {(duplicateRoom || overfull) && (
                <span className="text-xs text-destructive">
                  {duplicateRoom ? "Each room can take only one group of this section." : "A group is larger than the room's free benches."}
                </span>
              )}
            </div>
            {offeredRooms.length === 0 && (
              <p className="text-xs text-destructive">No room in this plan has a free bench layer for {dept}.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
