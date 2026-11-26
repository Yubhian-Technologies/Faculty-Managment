"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";

// Settings: extra time to post student attendance after college hours (College Admin; others see it read-only).
export function AttendancePostingCard() {
  const [saved, setSaved] = useState<number | null>(null);
  const [value, setValue] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lateSaved, setLateSaved] = useState<number | null>(null);
  const [lateValue, setLateValue] = useState("");
  const [canEditLate, setCanEditLate] = useState(false);
  const [lateBusy, setLateBusy] = useState(false);

  useEffect(() => {
    fetch("/api/college/settings/attendance-posting")
      .then((r) => (r.ok ? r.json() : null) as Promise<{ extraMinutes: number; canEdit: boolean; lateMarkDays?: number; canEditLateMark?: boolean } | null>)
      .then((d) => {
        if (!d) return;
        setSaved(d.extraMinutes); setValue(String(d.extraMinutes)); setCanEdit(d.canEdit);
        if (d.lateMarkDays != null) { setLateSaved(d.lateMarkDays); setLateValue(String(d.lateMarkDays)); }
        setCanEditLate(!!d.canEditLateMark);
      })
      .catch(() => undefined);
  }, []);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/college/settings/attendance-posting", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ extraMinutes: Number(value) }),
      });
      const d = (await res.json()) as { extraMinutes?: number; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Unable to save the posting time.");
      setSaved(d.extraMinutes ?? Number(value));
      toast({ title: "Attendance posting time saved." });
    } catch (e) {
      toast({ variant: "destructive", title: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function saveLate() {
    setLateBusy(true);
    try {
      const res = await fetch("/api/college/settings/attendance-posting", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lateMarkDays: Number(lateValue) }),
      });
      const d = (await res.json()) as { lateMarkDays?: number; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Unable to save the late marking days.");
      setLateSaved(d.lateMarkDays ?? Number(lateValue));
      toast({ title: "Late marking days saved." });
    } catch (e) {
      toast({ variant: "destructive", title: (e as Error).message });
    } finally {
      setLateBusy(false);
    }
  }

  if (saved === null) return null;
  const ln = Number(lateValue);
  const lateValid = Number.isInteger(ln) && ln >= 0 && ln <= 7;
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 0 && n <= 240;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Attendance Posting After College Hours</CardTitle>
        <CardDescription>
          Faculty can post a period&apos;s student attendance until the college end time. Extra minutes added here let them post after it too -
          for example 30 minutes with a 4:30 PM end time allows posting until 5:00 PM. A period posted after its own end still shows as Late.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="posting-extra">Extra Minutes</Label>
          <Input id="posting-extra" type="number" min={0} max={240} step={5} className="w-32" value={value} disabled={!canEdit} onChange={(e) => setValue(e.target.value)} />
        </div>
        {canEdit ? (
          <Button onClick={() => void save()} loading={busy} disabled={!valid || n === saved}>Save</Button>
        ) : (
          <p className="text-xs text-muted-foreground">Set by the College Admin.</p>
        )}
      </CardContent>
      {lateSaved !== null && (
        <CardContent className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">Late Marking</p>
          <p className="text-sm text-muted-foreground">
            A faculty member who missed posting a class can still mark it with a reason, up to this many days back. It counts at once, and the HOD
            of the class&apos;s department is told and sees it on Attendance Completion. 0 turns late marking off.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="late-mark-days">Days Back</Label>
              <Input id="late-mark-days" type="number" min={0} max={7} className="w-32" value={lateValue} disabled={!canEditLate} onChange={(e) => setLateValue(e.target.value)} />
            </div>
            {canEditLate ? (
              <Button onClick={() => void saveLate()} loading={lateBusy} disabled={!lateValid || ln === lateSaved}>Save</Button>
            ) : (
              <p className="text-xs text-muted-foreground">Set by the Principal.</p>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
