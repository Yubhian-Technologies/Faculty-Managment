"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { INCIDENT_VIEWED_EVENT } from "@/hooks/useIncidentUnread";
import type { IncidentAffectedType, IncidentReport } from "@/types";

const TYPE_LABELS: Record<IncidentAffectedType, string> = { STUDENT: "Student", FACULTY: "Faculty", BOTH: "Both" };

// yyyy-mm-dd is a calendar date, not an instant - parse it as local parts so it
// never slips a day across the timezone.
function formatIncidentDate(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value || "-";
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatSubmitted(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ordinalYear(year: number | null) {
  if (!year) return "-";
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

function NewDot() {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-red-500" role="img" aria-label="New" title="New" />;
}

// Read-only Incident Record: what College Office / College Admin saved, for
// Principal, Vice Principal, Dean Academics and the affected people's HOD.
// A red dot marks a report the viewer has not opened yet; opening it clears it.
export function IncidentRecordsView() {
  const [reports, setReports] = useState<IncidentReport[] | null>(null);
  const [openReport, setOpenReport] = useState<IncidentReport | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/incident-reports/inbox");
        const json = await res.json() as { reports?: IncidentReport[]; error?: string };
        if (!res.ok) {
          toast({ variant: "destructive", title: json.error ?? "Failed to load incident records" });
          setReports([]);
          return;
        }
        setReports(json.reports ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load incident records" });
        setReports([]);
      }
    })();
  }, []);

  async function open(report: IncidentReport) {
    setOpenReport(report);
    if (!report.unread) return;
    // Clear the dot first; put it back only if the server could not record the view.
    setReports((prev) => prev?.map((r) => (r.id === report.id ? { ...r, unread: false } : r)) ?? prev);
    try {
      const res = await fetch("/api/college/incident-reports/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: report.id }),
      });
      if (!res.ok) throw new Error("not recorded");
      window.dispatchEvent(new Event(INCIDENT_VIEWED_EVENT));
    } catch {
      setReports((prev) => prev?.map((r) => (r.id === report.id ? { ...r, unread: true } : r)) ?? prev);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Incident Record" description="Incidents recorded by the College Office." />

      <Card>
        <CardContent className="p-0">
          {reports === null ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Loading reports...</p>
          ) : reports.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">No incident records yet.</p>
          ) : (
            <>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5">Title</th>
                      <th className="px-4 py-2.5">Incident Date</th>
                      <th className="px-4 py-2.5">Affected</th>
                      <th className="px-4 py-2.5">Submitted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {reports.map((r) => (
                      <tr key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => void open(r)}>
                        <td className="px-4 py-3 font-medium">
                          <span className="flex items-center gap-2">{r.unread && <NewDot />}{r.title}</span>
                        </td>
                        <td className="px-4 py-3">{formatIncidentDate(r.incidentDate)}</td>
                        <td className="px-4 py-3"><Badge variant="secondary">{TYPE_LABELS[r.affectedType]}</Badge></td>
                        <td className="px-4 py-3 text-muted-foreground">{formatSubmitted(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y sm:hidden">
                {reports.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="w-full space-y-1 px-4 py-3 text-left hover:bg-muted/40" onClick={() => void open(r)}>
                      <span className="flex items-start justify-between gap-2">
                        <span className="flex items-center gap-2 font-medium">{r.unread && <NewDot />}{r.title}</span>
                        <Badge variant="secondary">{TYPE_LABELS[r.affectedType]}</Badge>
                      </span>
                      <span className="block text-xs text-muted-foreground">Incident: {formatIncidentDate(r.incidentDate)}</span>
                      <span className="block text-xs text-muted-foreground">Submitted: {formatSubmitted(r.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={openReport !== null} onOpenChange={(o) => { if (!o) setOpenReport(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {openReport && (
            <>
              <DialogHeader>
                <DialogTitle>{openReport.title}</DialogTitle>
                <DialogDescription>Incident record</DialogDescription>
              </DialogHeader>
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div><dt className="text-xs text-muted-foreground">Incident Date</dt><dd className="font-medium">{formatIncidentDate(openReport.incidentDate)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Affected</dt><dd className="font-medium">{TYPE_LABELS[openReport.affectedType]}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Submitted</dt><dd className="font-medium">{formatSubmitted(openReport.createdAt)}</dd></div>
              </dl>

              {openReport.students.length > 0 && (
                <section className="space-y-1.5">
                  <h4 className="text-sm font-semibold">Students ({openReport.students.length})</h4>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 text-left text-muted-foreground">
                        <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Regd. No.</th><th className="px-3 py-2">Course</th><th className="px-3 py-2">Department</th><th className="px-3 py-2">Year</th></tr>
                      </thead>
                      <tbody className="divide-y">
                        {openReport.students.map((s) => (
                          <tr key={s.id}>
                            <td className="px-3 py-2 font-medium">{s.name}</td>
                            <td className="px-3 py-2">{s.rollNumber}</td>
                            <td className="px-3 py-2">{s.course || "-"}</td>
                            <td className="px-3 py-2">{s.department}</td>
                            <td className="px-3 py-2">{ordinalYear(s.year)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {openReport.faculty.length > 0 && (
                <section className="space-y-1.5">
                  <h4 className="text-sm font-semibold">Faculty ({openReport.faculty.length})</h4>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 text-left text-muted-foreground">
                        <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Employee ID</th><th className="px-3 py-2">Department</th></tr>
                      </thead>
                      <tbody className="divide-y">
                        {openReport.faculty.map((f) => (
                          <tr key={f.id}>
                            <td className="px-3 py-2 font-medium">{f.name}</td>
                            <td className="px-3 py-2">{f.employeeId}</td>
                            <td className="px-3 py-2">{f.department}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <section className="space-y-1.5">
                <h4 className="text-sm font-semibold">Description</h4>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{openReport.description}</p>
              </section>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
