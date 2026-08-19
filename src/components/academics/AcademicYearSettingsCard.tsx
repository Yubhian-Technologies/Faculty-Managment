"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import {
  academicYearLongLabel, currentAcademicStartYear, parseAcademicYearStart,
  recentAcademicYearOptions, resolveCurrentAcademicYear,
} from "@/lib/college/academicSession";
import type { AcademicSession } from "@/types";

// The college's current academic year, set once here instead of being retyped
// into every course-year's own box. Course academic years default from this
// (see the course academic-year page), so a fresh course starts on the right
// session with nothing to fill in.
//
// Backed by the academicSessions collection, which already had a full CRUD API
// and an `isCurrent` flag but no UI at all - this is that UI, not a new store.

/** The sentinel for "follow the calendar", since Radix Select rejects "". */
const AUTO = "__auto__";

export function AcademicYearSettingsCard() {
  const [sessions, setSessions] = useState<AcademicSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const stored = useMemo(() => sessions.find((s) => s.isCurrent) ?? null, [sessions]);
  const derived = academicYearLongLabel(currentAcademicStartYear());
  const effective = resolveCurrentAcademicYear(stored?.label);
  const [choice, setChoice] = useState<string>(AUTO);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/college/academic-sessions");
      const json = await res.json() as { academicSessions?: AcademicSession[] };
      const list = json.academicSessions ?? [];
      setSessions(list);
      const current = list.find((s) => s.isCurrent);
      setChoice(current ? academicYearLongLabel(parseAcademicYearStart(current.label) ?? currentAcademicStartYear()) : AUTO);
    } catch {
      toast({ variant: "destructive", title: "Failed to load the academic year" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  // Options always include whatever is stored, even if it has aged out of the
  // recent window, so an existing choice is never silently dropped.
  const options = useMemo(() => {
    const set = new Set(recentAcademicYearOptions());
    if (stored) set.add(effective);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [stored, effective]);

  async function handleSave() {
    setIsSaving(true);
    try {
      if (choice === AUTO) {
        // Clearing the override: un-set whichever session is current and let
        // the calendar supply the year again.
        if (stored) {
          const res = await fetch("/api/college/academic-sessions", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: stored.id, isCurrent: false }),
          });
          if (!res.ok) throw new Error("Failed to clear the academic year");
        }
        toast({ variant: "success", title: `Following the calendar - now ${derived}` });
      } else {
        // The API keys sessions by label and enforces a single current one, so
        // an existing label is switched to current and a new one is created as
        // current - either way exactly one ends up set.
        const match = sessions.find((s) => parseAcademicYearStart(s.label) === parseAcademicYearStart(choice));
        const res = match
          ? await fetch("/api/college/academic-sessions", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: match.id, isCurrent: true }),
            })
          : await fetch("/api/college/academic-sessions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ label: choice, isCurrent: true }),
            });
        const json = await res.json() as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "Failed to set the academic year");
        toast({ variant: "success", title: `Academic year set to ${choice}` });
      }
      await load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setIsSaving(false);
    }
  }

  const isDirty = choice !== (stored ? effective : AUTO);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarClock className="h-4 w-4" />Academic Year
        </CardTitle>
        <CardDescription>
          The session the college is currently running. Every course&rsquo;s academic year
          defaults to this, so it only needs setting once.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="h-9 w-48 rounded-md bg-muted animate-pulse" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Current:</span>
              <Badge variant="secondary">{effective}</Badge>
              {!stored && (
                <span className="text-xs text-muted-foreground">
                  following the calendar &mdash; rolls over on its own each April
                </span>
              )}
            </div>

            <div className="space-y-2 max-w-xs">
              <Select value={choice} onValueChange={setChoice}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO}>Follow the calendar ({derived})</SelectItem>
                  {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Left on &ldquo;Follow the calendar&rdquo;, this advances by itself every year.
                Pin a session only if your academic calendar starts elsewhere.
              </p>
            </div>

            <Button onClick={() => void handleSave()} loading={isSaving} disabled={!isDirty}>
              Save
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
