"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Armchair, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/shared/EmptyState";
import { toast } from "@/hooks/useToast";
import type { ExamRoom, SeatingPlanStatus, SeatingSectionRef } from "@/types/examSeating";

interface PlanRow {
  id: string; name: string; status: SeatingPlanStatus; createdByName: string;
  roomCount: number; studentCount: number; unplacedCount: number;
}

// Exam Cell: name an exam, pick the sections (in seating order) and rooms,
// optionally handpick which sections may sit in a given room, then let the
// system place students by roll number and review the result.
export default function ExamSeatingPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [sections, setSections] = useState<SeatingSectionRef[]>([]);
  const [rooms, setRooms] = useState<ExamRoom[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [name, setName] = useState("");
  const [sectionIds, setSectionIds] = useState<string[]>([]); // click order = seating order
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [roomSections, setRoomSections] = useState<Record<string, string[]>>({});
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/college/exam-seating").then((r) => r.json() as Promise<{ plans?: PlanRow[] }>),
      fetch("/api/college/exam-seating/sections").then((r) => r.json() as Promise<{ sections?: SeatingSectionRef[] }>),
      fetch("/api/college/exam-rooms").then((r) => r.json() as Promise<{ rooms?: ExamRoom[] }>),
    ])
      .then(([p, s, r]) => {
        setPlans(p.plans ?? []);
        setSections(s.sections ?? []);
        const active = (r.rooms ?? []).filter((x) => x.isActive);
        setRooms(active);
        setRoomIds(active.map((x) => x.id));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load seating data" }))
      .finally(() => setIsLoading(false));
  }, []);

  const selectedSections = useMemo(
    () => sectionIds.map((id) => sections.find((s) => s.id === id)).filter((s): s is SeatingSectionRef => !!s),
    [sectionIds, sections]
  );
  const totalStudents = selectedSections.reduce((n, s) => n + s.studentCount, 0);
  const selectedRooms = rooms.filter((r) => roomIds.includes(r.id));
  const totalSeats = selectedRooms.reduce((n, r) => n + r.capacity, 0);

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function create() {
    setCreating(true);
    try {
      const res = await fetch("/api/college/exam-seating", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, sectionIds, roomIds, roomSections }),
      });
      const data = (await res.json()) as { id?: string; unplaced?: number; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Failed to build the plan");
      toast({
        variant: data.unplaced ? "default" : "success",
        title: data.unplaced ? `Plan built - ${data.unplaced} student(s) need a seat` : "Plan built - review it next",
      });
      router.push(`/exam-cell/seating/${data.id}`);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to build the plan" });
    } finally {
      setCreating(false);
    }
  }

  if (isLoading) return <div className="h-40 rounded-lg border bg-muted/30 animate-pulse" />;

  return (
    <div className="space-y-6">
      <PageHeader title="Exam Seating" description="Build a room-wise seating plan for an exam, review it, then print it." />

      <Card>
        <CardHeader><CardTitle className="text-base">New seating plan</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="max-w-sm space-y-1.5">
            <Label>Exam name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mid-1 Examinations, Oct 2026" />
          </div>

          <div className="space-y-2">
            <Label>Sections taking this exam (seated in the order you tick them)</Label>
            {sections.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sections found.</p>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 max-h-64 overflow-y-auto rounded-lg border p-3">
                {sections.map((s) => {
                  const order = sectionIds.indexOf(s.id);
                  return (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={order >= 0} onCheckedChange={() => setSectionIds((l) => toggle(l, s.id))} />
                      <span className="flex-1">{s.label}</span>
                      <span className="text-xs text-muted-foreground">{s.studentCount}</span>
                      {order >= 0 && <Badge variant="outline" className="text-[10px]">#{order + 1}</Badge>}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Rooms (filled in block → floor → room order)</Label>
            {rooms.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rooms yet - College Office adds them under Exam Rooms.</p>
            ) : (
              <div className="space-y-2 rounded-lg border p-3">
                {rooms.map((r) => {
                  const on = roomIds.includes(r.id);
                  return (
                    <div key={r.id} className="space-y-1.5">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox checked={on} onCheckedChange={() => setRoomIds((l) => toggle(l, r.id))} />
                        <span className="font-medium">{r.name}</span>
                        <span className="text-xs text-muted-foreground">Block {r.block} · Floor {r.floor} · {r.capacity} seats</span>
                      </label>
                      {on && selectedSections.length > 1 && (
                        <div className="ml-6 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-xs text-muted-foreground">Only these sections (optional):</span>
                          {selectedSections.map((s) => (
                            <label key={s.id} className="flex items-center gap-1 text-xs">
                              <Checkbox
                                checked={roomSections[r.id]?.includes(s.id) ?? false}
                                onCheckedChange={() => setRoomSections((m) => ({ ...m, [r.id]: toggle(m[r.id] ?? [], s.id) }))}
                              />
                              {s.label}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!name.trim() || sectionIds.length === 0 || roomIds.length === 0} loading={creating} onClick={() => void create()}>
              <Armchair className="h-4 w-4 mr-1" /> Allot seats
            </Button>
            <p className="text-sm text-muted-foreground">
              {totalStudents} students · {totalSeats} seats
              {totalStudents > totalSeats && <span className="text-destructive"> - {totalStudents - totalSeats} short, add rooms</span>}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="text-sm font-medium">Seating plans</h2>
        {plans.length === 0 ? (
          <EmptyState title="No plans yet" description="Build your first plan above." />
        ) : (
          plans.map((p) => (
            <Link key={p.id} href={`/exam-cell/seating/${p.id}`}>
              <Card className="hover:border-primary transition-colors mb-2">
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.studentCount} students · {p.roomCount} rooms · by {p.createdByName}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.unplacedCount > 0 && <Badge variant="rejected">{p.unplacedCount} unplaced</Badge>}
                    <Badge variant={p.status === "PUBLISHED" ? "approved" : "pending"}>{p.status === "PUBLISHED" ? "Published" : "Draft"}</Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
