"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Eye, Info, Lock } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { ExamConfiguration, InternalExamMarksBatch } from "@/types";

const ALL = "ALL";

export default function HodInternalExamPage() {
  const [batches, setBatches] = useState<(InternalExamMarksBatch & { id: string })[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [facultyFilter, setFacultyFilter] = useState(ALL);
  const [sectionFilter, setSectionFilter] = useState(ALL);
  const [subjectFilter, setSubjectFilter] = useState(ALL);

  const [selectedBatch, setSelectedBatch] = useState<(InternalExamMarksBatch & { id: string }) | null>(null);
  const [selectedConfig, setSelectedConfig] = useState<ExamConfiguration | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/college/internal-exam-marks");
        if (!res.ok) throw new Error("Failed to load submitted marks");
        const json = (await res.json()) as { batches?: (InternalExamMarksBatch & { id: string })[] };
        setBatches(json.batches ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load submitted internal exam marks" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const facultyOptions = useMemo(() => [...new Set(batches.map((b) => b.facultyName).filter(Boolean))].sort(), [batches]);
  const sectionOptions = useMemo(() => [...new Set(batches.map((b) => b.sectionName).filter(Boolean))].sort(), [batches]);
  const subjectOptions = useMemo(() => [...new Set(batches.map((b) => b.subjectName).filter(Boolean))].sort(), [batches]);

  const visibleBatches = batches.filter(
    (b) =>
      (facultyFilter === ALL || b.facultyName === facultyFilter) &&
      (sectionFilter === ALL || b.sectionName === sectionFilter) &&
      (subjectFilter === ALL || b.subjectName === subjectFilter)
  );

  async function openBatch(batch: InternalExamMarksBatch & { id: string }) {
    setSelectedBatch(batch);
    setSelectedConfig(null);
    setIsLoadingDetail(true);
    try {
      const res = await fetch(`/api/college/exam-configurations?subjectId=${encodeURIComponent(batch.subjectId)}`);
      const json = (await res.json()) as { configuration?: ExamConfiguration | null; error?: string };
      if (!res.ok || !json.configuration) throw new Error(json.error ?? "Exam configuration not found");
      setSelectedConfig(json.configuration);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to load marks breakdown" });
      setSelectedBatch(null);
    } finally {
      setIsLoadingDetail(false);
    }
  }

  const activeComponents = useMemo(
    () => (selectedConfig ? [...selectedConfig.components].filter((c) => c.isActive).sort((a, b) => a.order - b.order) : []),
    [selectedConfig]
  );

  function entryTotal(entry: InternalExamMarksBatch["entries"][number]): number {
    return activeComponents.reduce((sum, c) => sum + (entry.componentMarks[c.id] ?? 0), 0);
  }

  if (selectedBatch) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={`${selectedBatch.subjectName} — ${selectedBatch.sectionName}`}
          description="Submitted internal exam marks (view-only)"
          actions={
            <Button variant="outline" onClick={() => { setSelectedBatch(null); setSelectedConfig(null); }}>
              Back to list
            </Button>
          }
        />

        {isLoadingDetail || !selectedConfig ? (
          <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />
        ) : (
          <>
            <div className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Info className="h-4 w-4 shrink-0" />
                <span>
                  Faculty: <strong>{selectedBatch.facultyName}</strong>
                  <span className="mx-2 text-blue-300">|</span>
                  Total Students: <strong>{selectedBatch.totalStudents}</strong>
                  <span className="mx-2 text-blue-300">|</span>
                  Internal Max: <strong>{selectedConfig.internalMaxMarks}</strong>
                  <span className="mx-2 text-blue-300">|</span>
                  Submitted: <strong>{selectedBatch.submittedAt ? formatDate(selectedBatch.submittedAt) : "—"}</strong>
                </span>
              </div>
              <span className="flex items-center gap-1.5 font-medium text-emerald-700">
                <Lock className="h-4 w-4" /> Submitted (View-only)
              </span>
            </div>

            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">S.No</th>
                      <th className="px-4 py-3">Roll No.</th>
                      <th className="px-4 py-3">Student Name</th>
                      {activeComponents.map((c) => (
                        <th key={c.id} className="px-4 py-3">{c.name} (Max {c.maxMarks})</th>
                      ))}
                      <th className="px-4 py-3">Total (Out of {selectedConfig.internalMaxMarks})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {selectedBatch.entries.map((entry, i) => (
                      <tr key={entry.studentId}>
                        <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                        <td className="px-4 py-2.5">{entry.rollNumber}</td>
                        <td className="px-4 py-2.5 font-medium text-foreground">{entry.name}</td>
                        {activeComponents.map((c) => (
                          <td key={c.id} className="px-4 py-2.5">{entry.componentMarks[c.id] ?? "—"}</td>
                        ))}
                        <td className="px-4 py-2.5 font-semibold text-foreground">{entryTotal(entry)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Internal Exam Marks"
        description="Submitted internal exam marks for your department (view-only)"
      />

      {isLoading ? (
        <div className="h-40 rounded-lg border bg-muted/30 animate-pulse" />
      ) : batches.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No internal exam marks have been submitted yet for your department.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Faculty</Label>
                  <Select value={facultyFilter} onValueChange={setFacultyFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All Faculty</SelectItem>
                      {facultyOptions.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Section</Label>
                  <Select value={sectionFilter} onValueChange={setSectionFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All Sections</SelectItem>
                      {sectionOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Subject</Label>
                  <Select value={subjectFilter} onValueChange={setSubjectFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All Subjects</SelectItem>
                      {subjectOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Faculty</th>
                    <th className="px-4 py-3">Section</th>
                    <th className="px-4 py-3">Year</th>
                    <th className="px-4 py-3">Subject</th>
                    <th className="px-4 py-3">Students</th>
                    <th className="px-4 py-3">Submitted</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visibleBatches.map((b) => (
                    <tr key={b.id}>
                      <td className="px-4 py-2.5 font-medium text-foreground">{b.facultyName}</td>
                      <td className="px-4 py-2.5">{b.sectionName}</td>
                      <td className="px-4 py-2.5">{b.year ?? "—"}</td>
                      <td className="px-4 py-2.5">{b.subjectName} <span className="text-muted-foreground">({b.subjectCode})</span></td>
                      <td className="px-4 py-2.5">{b.totalStudents}</td>
                      <td className="px-4 py-2.5">{b.submittedAt ? formatDate(b.submittedAt) : "—"}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Button variant="ghost" size="sm" onClick={() => void openBatch(b)}>
                          <Eye className="h-3.5 w-3.5" /> View
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {visibleBatches.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        <ClipboardCheck className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                        No submitted marks match the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
