"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { SelfCheckInMethodSection } from "@/components/attendance/SelfCheckInMethodSection";
import { lateAfterOf, MAX_GRACE_MINUTES } from "@/lib/attendance/attendanceTimings";

// Principal / VP / College Office: the college's start time and grace minutes for faculty and staff self check-in.
// A check-in after start + grace is Late (a reason is asked for, and 3 late check-ins = 0.5 CL). Saved per college;
// each day keeps the cut-off it was recorded with (api/college/settings/attendance-timings).
export function AttendanceTimingsCard() {
  const [startTime, setStartTime] = useState("09:00");
  const [grace, setGrace] = useState("5");
  const [meta, setMeta] = useState<{ isDefault: boolean; updatedAt: string | null; updatedByName: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/college/settings/attendance-timings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { timings: { startTime: string; graceMinutes: number }; isDefault: boolean; updatedAt: string | null; updatedByName: string | null } | null) => {
        if (!d) return;
        setStartTime(d.timings.startTime);
        setGrace(String(d.timings.graceMinutes));
        setMeta({ isDefault: d.isDefault, updatedAt: d.updatedAt, updatedByName: d.updatedByName });
      })
      .catch(() => toast({ variant: "destructive", title: "Unable to load the attendance timings." }));
  }, []);

  const graceNum = Number(grace);
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) && Number.isInteger(graceNum) && graceNum >= 0 && graceNum <= MAX_GRACE_MINUTES;
  const cutoff = valid ? lateAfterOf({ startTime, graceMinutes: graceNum }) : null;

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/college/settings/attendance-timings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime, graceMinutes: graceNum }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: j.error ?? "Unable to save the attendance timings." }); return; }
      toast({ variant: "success", title: "Attendance timings saved." });
      setMeta({ isDefault: false, updatedAt: new Date().toISOString(), updatedByName: null });
    } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4" />Attendance Timings</CardTitle>
        <CardDescription>
          When faculty and staff are expected to check in. A check-in after the start time plus the grace minutes is Late: a reason is asked for, and three late check-ins deduct half a day of CL.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="att-start">Start Time</Label>
            <Input id="att-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="att-grace">Grace Minutes</Label>
            <Input id="att-grace" type="number" min={0} max={MAX_GRACE_MINUTES} value={grace} onChange={(e) => setGrace(e.target.value)} />
          </div>
        </div>
        <p className="text-sm">
          {cutoff ? <>A check-in after <strong>{cutoff}</strong> is Late; {cutoff} itself is on time.</> : <span className="text-destructive">Enter a start time and grace minutes from 0 to {MAX_GRACE_MINUTES}.</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {meta?.isDefault ? "Not set yet: the standard 09:00 with 5 minutes' grace applies." : meta?.updatedAt ? `Last changed ${new Date(meta.updatedAt).toLocaleString("en-IN")}${meta.updatedByName ? ` by ${meta.updatedByName}` : ""}.` : ""}
          {" "}A change applies to check-ins from now on (within a minute); days already recorded keep the time they were recorded with.
        </p>
        <Button onClick={() => void save()} loading={busy} disabled={!valid}>Save</Button>
        <SelfCheckInMethodSection />
      </CardContent>
    </Card>
  );
}
