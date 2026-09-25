"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import {
  academicSessionLabel, academicYearRange, currentAcademicStartYear, displayDate,
  resolveAcademicYearEnd, resolveAcademicYearStart,
} from "@/lib/college/academicSession";
import type { AcademicSession, FacultyNorms } from "@/types";

// The college says only WHEN its academic year begins - June 1, April 1,
// whatever it keeps. The year itself is never entered and never stored: it is
// worked out from today against that day, so it rolls over on its own (a
// June-1 college is in 2026-27 until 31 May 2027, and in 2027-28 the next
// morning). That matters because this app has no scheduler; a stored year
// would sit on the wrong value until somebody noticed.
//
// This used to be a dropdown of four fixed years, with the span beside it
// always rendered 01/04-31/03 because nothing but a label was stored. A
// college running June-May was shown a span it does not keep, and had no way
// to correct it.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function AcademicYearSettingsCard() {
  const [month, setMonth] = useState(4);
  const [day, setDay] = useState(1);
  const [endMonth, setEndMonth] = useState(3);
  const [endDay, setEndDay] = useState(31);
  const [saved, setSaved] = useState({ month: 4, day: 1, endMonth: 3, endDay: 31 });
  const [pinned, setPinned] = useState<AcademicSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [settingsRes, sessionsRes] = await Promise.all([
        fetch("/api/college/settings/general").then((r) => r.json() as Promise<{ settings?: FacultyNorms }>),
        // Only to warn about a session pinned before this was configurable -
        // one of those still overrides the calculation server-side.
        fetch("/api/college/academic-sessions")
          .then((r) => r.json() as Promise<{ academicSessions?: AcademicSession[] }>)
          .catch(() => ({ academicSessions: [] })),
      ]);
      const start = resolveAcademicYearStart(settingsRes.settings);
      const end = resolveAcademicYearEnd(settingsRes.settings);
      setMonth(start.month);
      setDay(start.day);
      setEndMonth(end.month);
      setEndDay(end.day);
      setSaved({ month: start.month, day: start.day, endMonth: end.month, endDay: end.day });
      setPinned((sessionsRes.academicSessions ?? []).find((s) => s.isCurrent) ?? null);
    } catch {
      toast({ variant: "destructive", title: "Failed to load the academic year" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  // What today resolves to under the day currently in the boxes - so the
  // consequence of a change is visible before it is saved.
  const preview = useMemo(() => {
    const start = { month, day };
    // Only the START decides which year you are in; the end just closes it.
    const startYear = currentAcademicStartYear(new Date(), start);
    const range = academicYearRange(startYear, start, { month: endMonth, day: endDay });
    return { label: academicSessionLabel(startYear), range };
  }, [month, day, endMonth, endDay]);

  const inRange = (n: number) => Number.isInteger(n) && n >= 1 && n <= 31;
  const sameDay = month === endMonth && day === endDay;
  const dayValid = inRange(day) && inRange(endDay) && !sameDay;
  const isDirty = month !== saved.month || day !== saved.day
    || endMonth !== saved.endMonth || endDay !== saved.endDay;

  async function handleSave() {
    if (!dayValid) {
      toast({ variant: "destructive", title: "Day must be between 1 and 31" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/settings/general", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          academicYearStartMonth: month, academicYearStartDay: day,
          academicYearEndMonth: endMonth, academicYearEndDay: endDay,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to save the academic year");
      toast({
        variant: "success",
        title: `Academic year now runs ${day} ${MONTHS[month - 1]} to ${endDay} ${MONTHS[endMonth - 1]} - currently ${preview.label}`,
      });
      await load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setIsSaving(false);
    }
  }

  // A session pinned under the old screen still wins over the calculation.
  // Clearing it is what lets this college start advancing on its own.
  async function handleClearPinned() {
    if (!pinned) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/academic-sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pinned.id, isCurrent: false }),
      });
      if (!res.ok) throw new Error("Failed to clear the pinned session");
      toast({ variant: "success", title: `Now calculated from the start date - currently ${preview.label}` });
      await load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarClock className="h-4 w-4" />Academic Year
        </CardTitle>
        <CardDescription>
          Set the days your academic year begins and ends. The year itself is worked
          out from today and moves on by itself each cycle &mdash; there is nothing to
          update when it rolls over.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="h-9 w-48 rounded-md bg-muted animate-pulse" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Current:</span>
              <Badge variant="secondary">{preview.label}</Badge>
              <span className="text-xs text-muted-foreground">
                {displayDate(preview.range.from)} &ndash; {displayDate(preview.range.to)}
              </span>
            </div>

            {pinned && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-2">
                <p>
                  <span className="font-medium text-foreground">{pinned.label}</span> is pinned
                  from the old settings screen, and overrides the calculation everywhere. It will
                  not advance on its own.
                </p>
                <Button size="sm" variant="outline" onClick={() => void handleClearPinned()} disabled={isSaving}>
                  Clear it and calculate instead
                </Button>
              </div>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Starts in</Label>
                <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ay-day" className="text-xs">on day</Label>
                <Input
                  id="ay-day" type="number" min={1} max={31} className="w-20"
                  value={day} onChange={(e) => setDay(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Ends in</Label>
                <Select value={String(endMonth)} onValueChange={(v) => setEndMonth(Number(v))}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ay-end-day" className="text-xs">on day</Label>
                <Input
                  id="ay-end-day" type="number" min={1} max={31} className="w-20"
                  value={endDay} onChange={(e) => setEndDay(Number(e.target.value))}
                />
              </div>
            </div>
            {!inRange(day) || !inRange(endDay)
              ? <p className="text-xs text-destructive">Days must be between 1 and 31.</p>
              : sameDay
                ? <p className="text-xs text-destructive">The year can&rsquo;t start and end on the same day.</p>
                : null}

            <Button onClick={() => void handleSave()} loading={isSaving} disabled={!isDirty || !dayValid}>
              Save
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
