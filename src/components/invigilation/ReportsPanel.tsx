"use client";

import { useMemo, useState } from "react";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { downloadTablePdf, downloadTableXlsx } from "@/lib/attendance/tableExport";
import { buildReport, REPORTS, type ReportKey } from "./reports";
import type { Overview } from "./model";

// Exam Cell > Invigilation > Reports: each report on screen, to Excel or PDF.

export function ReportsPanel({ overview }: { overview: Overview }) {
  const [key, setKey] = useState<ReportKey>("faculty");
  const [busy, setBusy] = useState<"x" | "p" | null>(null);
  const report = useMemo(() => buildReport(key, overview), [key, overview]);
  const label = REPORTS.find((r) => r.key === key)!.label;
  const file = `${overview.schedule.name}-${label}`.replace(/[^a-z0-9]+/gi, "-");

  async function download(kind: "x" | "p") {
    setBusy(kind);
    try {
      const t = { title: label, subtitle: overview.schedule.name, ...report };
      if (kind === "x") await downloadTableXlsx(t, `${file}.xlsx`);
      else await downloadTablePdf(t, `${file}.pdf`);
    } catch {
      toast({ variant: "destructive", title: "Could not make the file" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {REPORTS.map((r) => <Button key={r.key} size="sm" variant={r.key === key ? "default" : "outline"} onClick={() => setKey(r.key)}>{r.label}</Button>)}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" loading={busy === "x"} disabled={!report.rows.length} onClick={() => void download("x")}><FileSpreadsheet className="mr-1 h-4 w-4" />Excel</Button>
        <Button size="sm" variant="outline" loading={busy === "p"} disabled={!report.rows.length} onClick={() => void download("p")}><FileDown className="mr-1 h-4 w-4" />PDF</Button>
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {report.rows.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Nothing to show yet.</p> : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr>{report.headers.map((h) => <th key={h} className="whitespace-nowrap p-2">{h}</th>)}</tr></thead>
              <tbody>{report.rows.map((row, i) => <tr key={i} className="border-t align-top">{row.map((c, j) => <td key={j} className="p-2">{c}</td>)}</tr>)}</tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
