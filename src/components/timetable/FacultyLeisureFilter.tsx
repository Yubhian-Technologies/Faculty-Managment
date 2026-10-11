"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/useToast";
import { useCollegeInfo } from "@/hooks/useCollegeInfo";
import { downloadFreeFacultyPdf, downloadFreeFacultyXlsx } from "@/lib/timetable/freeFacultyExport";
import { formatTime12h } from "@/lib/timetable/facultyTimetablePdf";
interface LeisureFaculty { id: string; employeeId: string; name: string; department: string; freeRanges?: [string, string][] }

// College-wide "who is free at this time" (Principal, Vice Principal, Exam
// Cell): pick a date and a clock window, and every faculty member with no
// class then is listed grouped by department. Backed by
// /api/college/faculty-leisure, which enforces the same role list.
//
// The filters are a DATE rather than a weekday, a from/to window, and an
// optional department. A date is what someone arranging an exam or a meeting
// actually holds; the server resolves it to the weekday the timetable is
// keyed by, and refuses a date that is not a working day. The window matches
// any period it OVERLAPS, so it never has to line up with period boundaries -
// which is why there is no period picker here.
export function FacultyLeisureFilter({ scopeLabel = "in the college" }: { scopeLabel?: string } = {}) {
  const { collegeInfo } = useCollegeInfo();
  const college = collegeInfo ?? undefined;
  const [departments, setDepartments] = useState<string[]>([]);

  const [department, setDepartment] = useState("");
  const [date, setDate] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [faculty, setFaculty] = useState<LeisureFaculty[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // What the loaded list is actually for - the pickers may have moved on since.
  const [loadedSlot, setLoadedSlot] = useState("");
  const [exporting, setExporting] = useState<"" | "pdf" | "xlsx">("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const d = await fetch("/api/college/faculty-leisure").then((r) => r.json() as Promise<{
          departments?: string[];
        }>);
        if (cancelled) return;
        setDepartments(d.departments ?? []);
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load the free-faculty filter" });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Any change to the criteria invalidates the list already on screen - it was
  // loaded for different criteria and would otherwise be read as this one.
  function change<T>(set: (v: T) => void) {
    return (v: T) => { set(v); setFaculty(null); };
  }

  const windowValid = !!from && !!to && from < to;
  const canLoad = !!date && windowValid && !isLoading;

  async function load() {
    if (!canLoad) return;
    setIsLoading(true);
    try {
      const qs = new URLSearchParams({ date, from, to });
      if (department) qs.set("department", department);

      const d = await fetch(`/api/college/faculty-leisure?${qs.toString()}`).then((r) => r.json() as Promise<{
        faculty?: LeisureFaculty[]; error?: string;
      }>);
      if (d.error) throw new Error(d.error);
      setFaculty(d.faculty ?? []);
      setLoadedSlot(describeSlot());
    } catch (err) {
      setFaculty(null);
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to load free faculty" });
    } finally {
      setIsLoading(false);
    }
  }

  function describeSlot(): string {
    const parts = [formatDate(date), `${formatTime12h(from)} - ${formatTime12h(to)}`];
    if (department) parts.push(department);
    return parts.join(", ");
  }

  async function exportList(kind: "pdf" | "xlsx") {
    if (!faculty) return;
    setExporting(kind);
    try {
      const base = `free-faculty-${loadedSlot.replace(/[^A-Za-z0-9]+/g, "-")}`;
      if (kind === "pdf") await downloadFreeFacultyPdf(faculty, loadedSlot, base, [from, to], college);
      else await downloadFreeFacultyXlsx(faculty, loadedSlot, base, [from, to], college);
    } catch {
      toast({ variant: "destructive", title: "Download failed" });
    } finally {
      setExporting("");
    }
  }

  const fieldClass =
    "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none";
  const byDepartment = new Map<string, LeisureFaculty[]>();
  for (const f of faculty ?? []) {
    byDepartment.set(f.department || "Unassigned", [...(byDepartment.get(f.department || "Unassigned") ?? []), f]);
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div>
          <h3 className="text-sm font-semibold">Leisure faculty</h3>
          <p className="text-xs text-muted-foreground">
            Pick a date and a time range to list every faculty member {scopeLabel} with no class then.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Department</span>
            <select aria-label="Department" className={fieldClass} value={department} onChange={(e) => change(setDepartment)(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Date</span>
            <input type="date" aria-label="Date" className={fieldClass} value={date} onChange={(e) => change(setDate)(e.target.value)} />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Time to</span>
            <input type="time" aria-label="Time to" className={fieldClass} value={to} onChange={(e) => change(setTo)(e.target.value)} />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Time from</span>
            <input type="time" aria-label="Time from" className={fieldClass} value={from} onChange={(e) => change(setFrom)(e.target.value)} />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            onClick={() => void load()}
            disabled={!canLoad}
          >
            {isLoading ? "Loading..." : "Load"}
          </button>
          {from && to && from >= to && (
            <p className="text-xs text-destructive">&ldquo;Time to&rdquo; must be after &ldquo;Time from&rdquo;.</p>
          )}
          {!date && <p className="text-xs text-muted-foreground">Pick a date to start.</p>}
          {date && !from && !to && (
            <p className="text-xs text-muted-foreground">Set a time range.</p>
          )}
        </div>

        {isLoading ? (
          <div className="h-16 rounded-md bg-muted/30 animate-pulse" />
        ) : faculty ? (
          faculty.length === 0 ? (
            <p className="text-sm text-muted-foreground">No faculty are free at this time.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{faculty.length} free &middot; <span className="font-normal text-muted-foreground">{loadedSlot}</span></p>
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
                          <th className="px-3 py-2 font-medium">Free</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((f, i) => (
                          <tr key={f.id} className="border-t">
                            <td className="px-3 py-2">{i + 1}</td>
                            <td className="px-3 py-2">{f.employeeId || "-"}</td>
                            <td className="px-3 py-2">{f.name}</td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {f.freeRanges
                                ? f.freeRanges.map(([a, b]) => `${formatTime12h(a)} - ${formatTime12h(b)}`).join(", ")
                                : `${formatTime12h(from)} - ${formatTime12h(to)}`}
                            </td>
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

// "2026-10-05" -> "Mon, 05 Oct 2026". Built from the parts rather than
// new Date(iso) so the day never slips a date either side of UTC midnight.
function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}
