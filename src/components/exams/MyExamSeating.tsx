"use client";

import { useEffect, useState } from "react";
import { Armchair, DoorOpen } from "lucide-react";

// Published exam seating, read-only: a student's own seats, or the rooms where
// a faculty member's students sit (GET /api/college/exam-seating/mine decides).
// A Mid's seating holds for every exam day of that Mid.

interface Head { planId: string; exam: string; when: string; room: string; block: string; floor: number }
type Seat = Head & { seat: string; rollNumber: string };
type Room = Head & { total: number; sections: { sectionLabel: string; from: string; to: string; count: number }[] };

const when = (h: Head) => h.when;

export function MyExamSeating({ mode }: { mode: "student" | "faculty" }) {
  const [data, setData] = useState<{ seats?: Seat[]; rooms?: Room[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/college/exam-seating/mine")
      .then(async (r) => { const d = (await r.json()) as { seats?: Seat[]; rooms?: Room[]; error?: string }; if (!r.ok) throw new Error(d.error ?? "Failed to load"); setData(d); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  if (error) return <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</p>;
  if (!data) return <div className="h-40 animate-pulse rounded-2xl bg-muted" />;
  const list = mode === "student" ? data.seats ?? [] : data.rooms ?? [];
  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary"><Armchair className="h-6 w-6" /></span>
        <p className="font-semibold">No exam seating yet</p>
        <p className="max-w-md text-sm text-muted-foreground">{mode === "student" ? "Your room and bench appear here once the Exam Cell publishes the seating." : "The rooms where your students sit appear here once the Exam Cell publishes the seating."}</p>
      </div>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {mode === "student" ? (data.seats ?? []).map((s) => (
        <div key={`${s.planId}|${s.room}`} className="rounded-2xl border bg-card p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.exam}</p>
          <p className="text-sm text-muted-foreground">{when(s)}</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-primary/5 p-3 text-center ring-1 ring-primary/15"><p className="text-xs text-muted-foreground">Room</p><p className="text-2xl font-bold">{s.room}</p><p className="text-xs text-muted-foreground">Block {s.block} · Floor {s.floor}</p></div>
            <div className="rounded-xl bg-primary/5 p-3 text-center ring-1 ring-primary/15"><p className="text-xs text-muted-foreground">Bench / seat</p><p className="text-2xl font-bold">{s.seat}</p><p className="text-xs text-muted-foreground">{s.rollNumber}</p></div>
          </div>
        </div>
      )) : (data.rooms ?? []).map((r) => (
        <div key={`${r.planId}|${r.room}`} className="rounded-2xl border bg-card p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{r.exam}</p>
          <p className="text-sm text-muted-foreground">{when(r)}</p>
          <p className="mt-3 flex items-center gap-2 text-lg font-semibold"><DoorOpen className="h-5 w-5 text-primary" />Room {r.room} <span className="text-sm font-normal text-muted-foreground">Block {r.block} · Floor {r.floor} · {r.total} students</span></p>
          <ul className="mt-2 space-y-1 text-sm">
            {r.sections.map((g) => <li key={g.sectionLabel}><span className="font-medium">{g.sectionLabel}</span>: {g.from} - {g.to} ({g.count})</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}
