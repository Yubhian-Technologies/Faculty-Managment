"use client";

import { useEffect, useState } from "react";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import { useCollegeInfo } from "@/hooks/useCollegeInfo";
import { dmy, type TopicRow } from "@/lib/studentAttendance/topicsCovered";
import { downloadTopicsCoveredPdf, downloadTopicsCoveredXlsx } from "@/lib/studentAttendance/topicsCoveredExport";

interface TopicSubject { assignmentId: string; subjectName: string; subjectCode: string; sectionName: string; year?: number; department: string }

const subjectLabel = (s: TopicSubject) => `${s.subjectName}${s.sectionName ? ` - ${s.sectionName}` : ""}`;

// "Topics covered": what the faculty member wrote as the class work when they
// submitted student attendance, one row per class day with that day's periods
// (the college's Topics Covered register). Always their own sessions.
export default function TopicsCoveredPage() {
  const { user } = useAuth();
  const { collegeInfo } = useCollegeInfo();
  const [subjects, setSubjects] = useState<TopicSubject[] | null>(null);
  const [assignmentId, setAssignmentId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<TopicRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<"" | "pdf" | "xlsx">("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/topics-covered");
        if (!res.ok) throw new Error();
        const json = (await res.json()) as { subjects?: TopicSubject[] };
        const list = json.subjects ?? [];
        setSubjects(list);
        if (list.length === 1) setAssignmentId(list[0].assignmentId);
      } catch {
        toast({ variant: "destructive", title: "Failed to load your subjects" });
        setSubjects([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!assignmentId) { setRows(null); return; }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const qs = new URLSearchParams({ assignmentId });
        if (from) qs.set("from", from);
        if (to) qs.set("to", to);
        const res = await fetch(`/api/college/topics-covered?${qs}`);
        const json = (await res.json()) as { rows?: TopicRow[]; error?: string };
        if (!res.ok) throw new Error(json.error || "Failed to load");
        if (!cancelled) setRows(json.rows ?? []);
      } catch (e) {
        if (!cancelled) {
          setRows([]);
          toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to load topics" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [assignmentId, from, to]);

  const current = subjects?.find((s) => s.assignmentId === assignmentId);

  async function exportList(kind: "pdf" | "xlsx") {
    if (!rows || !current) return;
    setExporting(kind);
    try {
      const meta = { subject: subjectLabel(current), faculty: user?.name ?? "", college: collegeInfo ?? undefined };
      const base = `topics-covered-${(current.subjectCode || current.subjectName).replace(/[^A-Za-z0-9]+/g, "-")}`;
      if (kind === "pdf") await downloadTopicsCoveredPdf(rows, meta, base);
      else await downloadTopicsCoveredXlsx(rows, meta, base);
    } catch {
      toast({ variant: "destructive", title: "Download failed" });
    } finally {
      setExporting("");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Topics Covered" description="The class work you recorded while marking student attendance, day by day" />
      {subjects === null ? (
        <div className="h-40 rounded-lg border bg-muted/30 animate-pulse" />
      ) : subjects.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No attendance has been submitted yet, so there are no topics to show.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Subject</label>
              <Select value={assignmentId} onValueChange={setAssignmentId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select a subject" /></SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => <SelectItem key={s.assignmentId} value={s.assignmentId}>{subjectLabel(s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">From</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">To</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
            </div>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" disabled={!rows?.length || exporting !== ""} onClick={() => void exportList("pdf")}>
                <FileDown className="mr-1.5 h-3.5 w-3.5" />{exporting === "pdf" ? "Generating PDF..." : "PDF"}
              </Button>
              <Button size="sm" variant="outline" disabled={!rows?.length || exporting !== ""} onClick={() => void exportList("xlsx")}>
                <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />{exporting === "xlsx" ? "Exporting Excel..." : "Excel"}
              </Button>
            </div>
          </div>

          {!assignmentId ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Pick a subject to see its topics.</div>
          ) : loading ? (
            <div className="h-40 rounded-lg border bg-muted/30 animate-pulse" />
          ) : !rows || rows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No topics recorded for this subject in the chosen dates.</div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="w-16 px-3 py-2 font-medium">S.No</th>
                        <th className="w-32 px-3 py-2 font-medium">Date</th>
                        <th className="w-36 px-3 py-2 font-medium">No. of Periods</th>
                        <th className="px-3 py-2 font-medium">Topics</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.date} className="border-t align-top">
                          <td className="px-3 py-2">{i + 1}</td>
                          <td className="px-3 py-2">{dmy(r.date)}</td>
                          <td className="px-3 py-2">{r.periods.join(",") || "-"}</td>
                          <td className="px-3 py-2">{r.topics || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
