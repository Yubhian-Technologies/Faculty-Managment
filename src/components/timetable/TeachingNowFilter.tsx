"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/useToast";
import { formatTime12h } from "@/lib/timetable/facultyTimetablePdf";
import { useCollegeInfo } from "@/hooks/useCollegeInfo";
import { downloadTeachingNowPdf, downloadTeachingNowXlsx } from "@/lib/timetable/teachingNowExport";

interface TeachingClass { classroom: string; classLabel: string; year?: string; deptSection?: string; subject: string; faculty: string }

// "Who is teaching right now" (Principal, Vice Principal, admins). No filters:
// opening it lists every class in session at this moment (IST) - room,
// year / department / section, subject and the faculty taking it - and Refresh
// re-reads the clock. Backed by /api/college/teaching-now, which enforces the roles.
export function TeachingNowFilter() {
  const { collegeInfo } = useCollegeInfo();
  const college = collegeInfo ?? undefined;
  const [classes, setClasses] = useState<TeachingClass[] | null>(null);
  const [asOf, setAsOf] = useState<{ date: string; from: string } | null>(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [exporting, setExporting] = useState<"" | "pdf" | "xlsx">("");

  const load = useCallback(async () => {
    setIsLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/college/teaching-now");
      const d = await res.json() as { classes?: TeachingClass[]; asOf?: { date: string; from: string }; error?: string };
      if (!res.ok || d.error) {
        // A non-working day is an answer, not a failure.
        if (res.status === 400) { setClasses(null); setAsOf(null); setMessage(d.error ?? ""); return; }
        throw new Error(d.error ?? "Failed to load");
      }
      setClasses(d.classes ?? []);
      setAsOf(d.asOf ?? null);
    } catch (err) {
      setClasses(null);
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to load classes" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function exportList(kind: "pdf" | "xlsx") {
    if (!classes || !asOf) return;
    setExporting(kind);
    try {
      const label = `${formatDate(asOf.date)}, ${formatTime12h(asOf.from)} IST`;
      const base = `teaching-now-${asOf.date}-${asOf.from.replace(":", "")}`;
      if (kind === "pdf") await downloadTeachingNowPdf(classes, label, base, college);
      else await downloadTeachingNowXlsx(classes, label, base, college);
    } catch {
      toast({ variant: "destructive", title: "Download failed" });
    } finally {
      setExporting("");
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Teaching at this time</h3>
            <p className="text-xs text-muted-foreground">
              {asOf ? `Classes in session now - ${formatDate(asOf.date)}, ${formatTime12h(asOf.from)} IST` : "Classes in session right now."}
            </p>
          </div>
          <button
            type="button"
            className="h-8 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
            onClick={() => void load()}
            disabled={isLoading}
          >
            {isLoading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {isLoading ? (
          <div className="h-16 rounded-md bg-muted/30 animate-pulse" />
        ) : message ? (
          <p className="text-sm text-muted-foreground">{message}</p>
        ) : classes ? (
          classes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No classes are in session at this time.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{classes.length} in session</p>
                <div className="flex gap-2">
                  <button type="button" className="h-8 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50" onClick={() => void exportList("xlsx")} disabled={exporting !== ""}>
                    {exporting === "xlsx" ? "Exporting..." : "Export Excel"}
                  </button>
                  <button type="button" className="h-8 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50" onClick={() => void exportList("pdf")} disabled={exporting !== ""}>
                    {exporting === "pdf" ? "Generating..." : "Download PDF"}
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="w-16 px-3 py-2 font-medium">S.No</th>
                      <th className="px-3 py-2 font-medium">Room No</th>
                      <th className="px-3 py-2 font-medium">Year</th>
                      <th className="px-3 py-2 font-medium">Dept - Sec</th>
                      <th className="px-3 py-2 font-medium">Subject</th>
                      <th className="px-3 py-2 font-medium">Faculty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classes.map((c, i) => (
                      <tr key={`${c.classLabel}|${c.subject}|${c.classroom}`} className="border-t">
                        <td className="px-3 py-2">{i + 1}</td>
                        <td className="px-3 py-2">{c.classroom || "-"}</td>
                        <td className="px-3 py-2">{c.year ?? c.classLabel}</td>
                        <td className="px-3 py-2">{c.deptSection ?? "-"}</td>
                        <td className="px-3 py-2">{c.subject}</td>
                        <td className="px-3 py-2 text-muted-foreground">{c.faculty || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

// "2026-10-05" -> "Mon, 05 Oct 2026". Built from the parts so the day never
// slips a date either side of UTC midnight.
function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}
