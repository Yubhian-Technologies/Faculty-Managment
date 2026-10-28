"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Armchair } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { roomBenches, roomPerBench } from "@/lib/exams/roomLayout";
import { SEAT_LETTERS } from "@/lib/exams/seatingPaired";
import { dayLabel } from "@/lib/midTimetable/rules";
import type { ExamRoom } from "@/types/examSeating";

// Paired seating from the Mid timetable - ONE arrangement for every exam day of
// the Mid: pick the Mid timetable(s) (their branches load), put each branch in a seat position -
// Seat A, Seat B (and C for 3-per-bench rooms) - in order, tick the rooms in the
// order they should fill, and build. Each bench takes the next student of every
// seat's stream; when a stream runs out its seat stays empty.

interface MidSource { id: string; label: string; midNumber: number; branches: number; days: string[] }
interface Group { key: string; label: string; courseName: string; subjects: string[]; count: number; sections: { id: string; name: string; count: number }[] }

export function PairedPlanCard({ rooms }: { rooms: ExamRoom[] }) {
  const router = useRouter();
  const [mids, setMids] = useState<MidSource[] | null>(null);
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [groups, setGroups] = useState<Group[] | null>(null);
  // seat index (0 = A) per group key; absent = not seated. Order within a seat = `order`.
  const [seatOf, setSeatOf] = useState<Record<string, number>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [roomIds, setRoomIds] = useState<string[]>([]); // tick order = fill order
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/college/exam-seating/paired").then((r) => r.json() as Promise<{ mids?: MidSource[] }>).then((d) => setMids(d.mids ?? [])).catch(() => setMids([]));
  }, []);
  useEffect(() => {
    if (planIds.length === 0) return;
    let cancelled = false;
    fetch(`/api/college/exam-seating/paired?planIds=${encodeURIComponent(planIds.join(","))}`)
      .then((r) => r.json() as Promise<{ groups?: Group[] }>)
      .then((d) => {
        if (cancelled) return;
        const list = d.groups ?? [];
        setGroups(list);
        // Start: the biggest group in Seat A, every other group in Seat B - the usual pairing.
        const sorted = [...list].sort((a, b) => b.count - a.count);
        setSeatOf(Object.fromEntries(sorted.map((g, i) => [g.key, i === 0 ? 0 : 1])));
        setOrder(sorted.map((g) => g.key));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load the branches for that date" }));
    return () => { cancelled = true; };
  }, [planIds]);

  const maxSeats = Math.max(1, ...rooms.map((r) => roomPerBench(r)));
  const streams = useMemo(() => Array.from({ length: maxSeats }, (_, s) => order.filter((k) => seatOf[k] === s)), [order, seatOf, maxSeats]);
  const usedStreams = streams.filter((s) => s.length);
  const countOf = (k: string) => groups?.find((g) => g.key === k)?.count ?? 0;
  const streamSize = (keys: string[]) => keys.reduce((n, k) => n + countOf(k), 0);
  const benchesNeeded = Math.max(0, ...usedStreams.map(streamSize));
  const picked = roomIds.map((id) => rooms.find((r) => r.id === id)).filter((r): r is ExamRoom => Boolean(r));
  const benchesPicked = picked.filter((r) => roomPerBench(r) >= usedStreams.length).reduce((n, r) => n + roomBenches(r), 0);

  function moveInOrder(key: string, dir: -1 | 1) {
    const seat = seatOf[key];
    const same = order.filter((k) => seatOf[k] === seat);
    const i = same.indexOf(key), j = i + dir;
    if (j < 0 || j >= same.length) return;
    const a = order.indexOf(same[i]), b = order.indexOf(same[j]);
    const next = [...order]; [next[a], next[b]] = [next[b], next[a]];
    setOrder(next);
  }

  async function create() {
    setCreating(true);
    try {
      const res = await fetch("/api/college/exam-seating/paired", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planIds, streams: usedStreams, roomIds }),
      });
      const data = (await res.json()) as { id?: string; unplaced?: number; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Could not build the plan");
      toast({ variant: data.unplaced ? "default" : "success", title: data.unplaced ? `Plan built - ${data.unplaced} student(s) need a seat (add rooms)` : "Plan built - review it next" });
      router.push(`/exam-cell/seating/${data.id}`);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not build the plan" });
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Paired plan from the Mid Timetable</CardTitle>
        <p className="text-sm text-muted-foreground">
          One arrangement for the whole Mid - every exam day. Pick the Mid timetable (its branches load), put each branch in a seat of the
          bench - e.g. Seat A: CSE, Seat B: Civil then Mech. Every bench gets one student from each seat&rsquo;s list, room after room in
          the order you tick them; when a list runs out its seat stays empty. Within a branch: section by section, each in Regd. No order.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Mid timetable{mids && mids.length > 1 ? "s (tick more than one to seat several years together)" : ""}</p>
            <div className="space-y-1.5 rounded-lg border p-3">
              {mids === null && <p className="text-sm text-muted-foreground">Loading...</p>}
              {mids?.length === 0 && <p className="text-sm text-muted-foreground">No Mid timetable with branches yet - make one under Mid Timetable.</p>}
              {(mids ?? []).map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={planIds.includes(m.id)}
                    onChange={() => { setGroups(null); setPlanIds((l) => (l.includes(m.id) ? l.filter((x) => x !== m.id) : [...l, m.id])); }} />
                  <span className="font-medium">{m.label}</span>
                  <span className="text-xs text-muted-foreground">{m.branches} branch{m.branches === 1 ? "" : "es"}{m.days.length ? ` · ${dayLabel(m.days[0])} - ${dayLabel(m.days[m.days.length - 1])}` : ""}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {groups && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Branches - choose the seat for each</p>
            {groups.length === 0 && <p className="text-sm text-muted-foreground">No branch in the Mid timetable picked.</p>}
            {Array.from({ length: maxSeats + 1 }, (_, s) => (s === maxSeats ? -1 : s)).map((s) => {
              const keys = s === -1 ? order.filter((k) => seatOf[k] === undefined) : streams[s];
              if (s === -1 && keys.length === 0) return null;
              return (
                <div key={s} className={cn("rounded-xl border p-3", s === -1 ? "border-dashed bg-muted/20" : "bg-card")}>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-semibold">{s === -1 ? "Not seated in this plan" : `Seat ${SEAT_LETTERS[s]}`}</span>
                    {s !== -1 && <span className="text-xs text-muted-foreground">{streamSize(keys)} students</span>}
                  </div>
                  {keys.length === 0 ? <p className="text-xs text-muted-foreground">No branch yet.</p> : (
                    <ul className="space-y-1.5">
                      {keys.map((k, i) => {
                        const g = groups.find((x) => x.key === k)!;
                        return (
                          <li key={k} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 px-2.5 py-2 text-sm">
                            {s !== -1 && <span className="w-5 text-center text-xs font-semibold text-muted-foreground">{i + 1}</span>}
                            <span className="min-w-0 flex-1">
                              <span className="font-medium">{g.label}</span> <span className="text-xs text-muted-foreground">· {g.count} students · {g.sections.map((x) => `${x.name} (${x.count})`).join(", ")} · {g.subjects.length} exam{g.subjects.length === 1 ? "" : "s"}</span>
                            </span>
                            {s !== -1 && (
                              <span className="flex">
                                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Move ${g.label} up`} disabled={i === 0} onClick={() => moveInOrder(k, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Move ${g.label} down`} disabled={i === keys.length - 1} onClick={() => moveInOrder(k, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                              </span>
                            )}
                            <select aria-label={`Seat for ${g.label}`} className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={seatOf[k] ?? ""}
                              onChange={(e) => setSeatOf((m) => { const n = { ...m }; if (e.target.value === "") delete n[k]; else n[k] = Number(e.target.value); return n; })}>
                              {Array.from({ length: maxSeats }, (_, x) => <option key={x} value={x}>Seat {SEAT_LETTERS[x]}</option>)}
                              <option value="">Not seated</option>
                            </select>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">Rooms - tick them in the order they should fill</p>
          <div className="grid max-h-56 gap-1.5 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-3">
            {rooms.map((r) => {
              const at = roomIds.indexOf(r.id);
              return (
                <label key={r.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={at >= 0} onChange={() => setRoomIds((l) => (at >= 0 ? l.filter((x) => x !== r.id) : [...l, r.id]))} />
                  <span className={cn("grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold", at >= 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{at >= 0 ? at + 1 : ""}</span>
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs text-muted-foreground">Block {r.block} · {roomBenches(r)} benches × {roomPerBench(r)}</span>
                </label>
              );
            })}
            {rooms.length === 0 && <p className="text-sm text-muted-foreground">No rooms yet - add them under Exam Rooms.</p>}
          </div>
        </div>

        {groups && usedStreams.length > 0 && (
          <p className={cn("text-sm", benchesPicked < benchesNeeded ? "text-destructive" : "text-muted-foreground")}>
            {usedStreams.map((k, i) => `Seat ${SEAT_LETTERS[i]}: ${streamSize(k)}`).join(" · ")} - needs {benchesNeeded} benches; {benchesPicked} picked
            {benchesPicked < benchesNeeded ? ` (${benchesNeeded - benchesPicked} short - add rooms)` : ""}
          </p>
        )}

        <Button disabled={planIds.length === 0 || usedStreams.length === 0 || roomIds.length === 0} loading={creating} onClick={() => void create()}>
          <Armchair className="mr-1 h-4 w-4" /> Build paired plan
        </Button>
      </CardContent>
    </Card>
  );
}
