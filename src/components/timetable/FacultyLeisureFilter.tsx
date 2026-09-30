"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/useToast";
import { downloadFreeFacultyPdf, downloadFreeFacultyXlsx } from "@/lib/timetable/freeFacultyExport";
import type { DayOfWeek } from "@/types";
import { DAY_LABELS } from "@/types";

interface LeisureFaculty { id: string; employeeId: string; name: string; department: string }

// College-wide "who is free at this time" (Principal, Vice Principal, Exam
// Cell): pick a day + period and every faculty member with no class then, in
// any department, is listed grouped by department. Backed by
// /api/college/faculty-leisure, which enforces the same role list.
export function FacultyLeisureFilter({ scopeLabel = "in the college" }: { scopeLabel?: string } = {}) {
  const [workingDays, setWorkingDays] = useState<DayOfWeek[]>([]);
  const [periodCount, setPeriodCount] = useState(0);
  const [day, setDay] = useState("");
  const [period, setPeriod] = useState("");
  const [faculty, setFaculty] = useState<LeisureFaculty[] | null>(null);
  
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const d = await fetch("/api/college/faculty-leisure").then((r) => r.json() as Promise<{ workingDays?: DayOfWeek[]; periodCount?: number }>);
        if (cancelled) return;
        setWorkingDays(d.workingDays ?? []);
        setPeriodCount(d.periodCount ?? 0);
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load leisure filter" });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Only fetched when Load is clicked, never on picking a day/period.
  const [isLoading, setIsLoading] = useState(false);
  async function load() {
    if (!day || !period) return;
    setIsLoading(true);
    try {
      const d = await fetch(`/api/college/faculty-leisure?day=${day}&period=${period}`).then((r) => r.json() as Promise<{ faculty?: LeisureFaculty[]; error?: string }>);
      if (d.error) throw new Error(d.error);
      setFaculty(d.faculty ?? []);
      setLoadedSlot(`${DAY_LABELS[day as DayOfWeek] ?? day}, Period ${period}`);
    } catch {
      setFaculty(null);
      toast({ variant: "destructive", title: "Failed to load free faculty" });
    } finally {
      setIsLoading(false);
    }
  }
  // The slot the loaded list is for (day/period pickers may have moved on).
  const [loadedSlot, setLoadedSlot] = useState("");
  const [exporting, setExporting] = useState<"" | "pdf" | "xlsx">("");
  async function exportList(kind: "pdf" | "xlsx") {
    if (!faculty) return;
    setExporting(kind);
    try {
      const base = `free-faculty-${loadedSlot.replace(/[^A-Za-z0-9]+/g, "-")}`;
      if (kind === "pdf") await downloadFreeFacultyPdf(faculty, loadedSlot, base);
      else await downloadFreeFacultyXlsx(faculty, loadedSlot, base);
    } catch {
      toast({ variant: "destructive", title: "Download failed" });
    } finally {
      setExporting("");
    }
  }
  function pickDay(v: string) { setDay(v); setFaculty(null); }
  function pickPeriod(v: string) { setPeriod(v); setFaculty(null); }
  const key = "loaded";

  const selectClass =
    "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none";
  const byDepartment = new Map<string, LeisureFaculty[]>();
  for (const f of key ? faculty ?? [] : []) {
    byDepartment.set(f.department || "Unassigned", [...(byDepartment.get(f.department || "Unassigned") ?? []), f]);
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div>
          <h3 className="text-sm font-semibold">Free faculty</h3>
          <p className="text-xs text-muted-foreground">Pick a day and period to list every faculty member {scopeLabel} with no class then.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <select aria-label="Day" className={selectClass} value={day} onChange={(e) => pickDay(e.target.value)}>
            <option value="">Select a day</option>
            {workingDays.map((d) => <option key={d} value={d}>{DAY_LABELS[d] ?? d}</option>)}
          </select>
          <select aria-label="Period" className={selectClass} value={period} onChange={(e) => pickPeriod(e.target.value)}>
            <option value="">Select a period</option>
            {Array.from({ length: periodCount }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Period {n}</option>)}
          </select>
          <button
            type="button"
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            onClick={() => void load()}
            disabled={!day || !period || isLoading}
          >
            {isLoading ? "Loading..." : "Load"}
          </button>
        </div>
        {isLoading ? (
          <div className="h-16 rounded-md bg-muted/30 animate-pulse" />
        ) : key && faculty ? (
          faculty.length === 0 ? (
            <p className="text-sm text-muted-foreground">No faculty are free at this time.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{faculty.length} free</p>
                <div className="flex gap-2">
                  <button type="button" className="h-8 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50" onClick={() => void exportList("xlsx")} disabled={exporting !== ""}>
                    {exporting === "xlsx" ? "Exporting..." : "Export Excel"}
                  </button>
                  <button type="button" className="h-8 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50" onClick={() => void exportList("pdf")} disabled={exporting !== ""}>
                    {exporting === "pdf" ? "Generating..." : "Download PDF"}
                  </button>
                </div>
              </div>
              {Array.from(byDepartment.entries()).map(([dept, list]) => (
                <div key={dept}>
                  <p className="text-sm font-semibold">{dept} ({list.length})</p>
                  <div className="mt-1 overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="w-16 px-3 py-2 font-medium">S.No</th>
                          <th className="px-3 py-2 font-medium">Employee ID</th>
                          <th className="px-3 py-2 font-medium">Name</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((f, i) => (
                          <tr key={f.id} className="border-t">
                            <td className="px-3 py-2">{i + 1}</td>
                            <td className="px-3 py-2">{f.employeeId || "-"}</td>
                            <td className="px-3 py-2">{f.name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
