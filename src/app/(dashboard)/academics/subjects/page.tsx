"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Plus, Pencil, Trash2, Upload, History, RefreshCw, FileSpreadsheet, FileText } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Pagination } from "@/components/shared/Pagination";
import { toast } from "@/hooks/useToast";
import type { Course, CourseCatalogItem, Subject } from "@/types";
import { SUBJECT_TYPE_LABELS } from "@/types";
import { academicSessionLabel, currentAcademicStartYear } from "@/lib/college/academicSession";

export default function AcademicsSubjectsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [courses, setCourses] = useState<Course[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [catalogItems, setCatalogItems] = useState<CourseCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);

  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedRegulation, setSelectedRegulation] = useState("");
  const [selectedAcademicYear, setSelectedAcademicYear] = useState(academicSessionLabel(currentAcademicStartYear()));
  const [currentSessionLabel, setCurrentSessionLabel] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Subject | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => { setCurrentPage(1); }, [selectedCourseId, selectedAcademicYear]);

  useEffect(() => {
    fetch("/api/college/courses")
      .then((r) => r.json() as Promise<{ courses: Course[] }>)
      .then((d) => {
        const active = (d.courses ?? []).filter((c) => c.isActive);
        const byCatalog = new Map<string, Course>();
        for (const c of active) {
          const key = c.catalogId ?? `name:${c.name.trim().toLowerCase()}`;
          if (!byCatalog.has(key)) byCatalog.set(key, c);
        }
        setCourses(Array.from(byCatalog.values()).sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load courses" }))
      .finally(() => setIsLoading(false));

    fetch("/api/college/course-catalog")
      .then((r) => r.json() as Promise<{ items?: CourseCatalogItem[] }>)
      .then((d) => setCatalogItems(d.items ?? []))
      .catch(() => {});

    fetch("/api/college/academic-sessions")
      .then((r) => r.json() as Promise<{ academicSessions?: { label: string; isCurrent: boolean }[] }>)
      .then((d) => {
        const current = (d.academicSessions ?? []).find((s) => s.isCurrent);
        if (current?.label) setCurrentSessionLabel(current.label);
      })
      .catch(() => { /* non-critical */ });
  }, []);

  const [showHistory, setShowHistory] = useState(false);
  const [sessionsWithSubjects, setSessionsWithSubjects] = useState<string[]>([]);
  const hasAppliedSessionRef = useRef(false);
  useEffect(() => {
    if (hasAppliedSessionRef.current || !currentSessionLabel || searchParams.get("academicYear")) return;
    hasAppliedSessionRef.current = true;
    setSelectedAcademicYear(currentSessionLabel);
  }, [currentSessionLabel, searchParams]);

  const selectedCourse = useMemo(() => courses.find((c) => c.id === selectedCourseId) ?? null, [courses, selectedCourseId]);
  const selectedCatalogItem = useMemo(
    () => catalogItems.find((c) => c.id === selectedCourse?.catalogId) ?? null,
    [catalogItems, selectedCourse]
  );
  const allowedRegulations = useMemo(
    () => selectedCatalogItem?.regulations ?? [],
    [selectedCatalogItem]
  );
  const singleRegulation = allowedRegulations.length === 1 ? allowedRegulations[0] : "";

  const sortedSubjects = useMemo(
    () => [...subjects].sort((a, b) => {
      if (a.serialNumber != null && b.serialNumber != null) return a.serialNumber - b.serialNumber;
      if (a.serialNumber != null) return -1;
      if (b.serialNumber != null) return 1;
      return a.name.localeCompare(b.name);
    }),
    [subjects]
  );
  const nextSerialNumber = useMemo(
    () => Math.max(0, ...subjects.map((s) => s.serialNumber ?? 0)) + 1,
    [subjects]
  );
  const totalPages = Math.max(1, Math.ceil(sortedSubjects.length / pageSize));
  const paginatedSubjects = sortedSubjects.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const loadSubjects = useCallback(async (courseId: string, academicYear: string, regulation: string) => {
    if (!courseId) { setSubjects([]); return; }
    setIsLoadingSubjects(true);
    try {
      const regulationsParam = allowedRegulations.length ? `&regulations=${encodeURIComponent(allowedRegulations.join(","))}` : "";
      const regulationParam = regulation ? `&regulation=${encodeURIComponent(regulation)}` : "";
      const res = await fetch(
        `/api/college/subjects?courseId=${encodeURIComponent(courseId)}${regulationsParam}${regulationParam}${academicYear ? `&academicYear=${encodeURIComponent(academicYear)}` : ""}`
      );
      const data = await res.json() as { subjects: Subject[]; academicYears?: string[] };
      setSessionsWithSubjects(data.academicYears ?? []);
      setSubjects(data.subjects ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load subjects" });
    } finally {
      setIsLoadingSubjects(false);
    }
  }, [allowedRegulations]);

  useEffect(() => {
    if (selectedCourseId) {
      void loadSubjects(selectedCourseId, selectedAcademicYear, selectedRegulation);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCourseId, selectedAcademicYear, selectedRegulation, allowedRegulations.join(","), loadSubjects]);

  const regulationsKey = allowedRegulations.join(",");
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (hasRestoredRef.current || isLoading || courses.length === 0) return;
    hasRestoredRef.current = true;
    const courseId = searchParams.get("courseId");
    const academicYear = searchParams.get("academicYear") || selectedAcademicYear;
    const regulation = searchParams.get("regulation") || "";
    if (!courseId) return;
    if (courses.some((c) => c.id === courseId)) {
      setSelectedCourseId(courseId);
      setSelectedAcademicYear(academicYear);
      if (regulation) setSelectedRegulation(regulation);
    }
  }, [isLoading, courses, searchParams, loadSubjects, selectedAcademicYear]);

  function selectCourse(courseId: string) {
    setSelectedCourseId(courseId);
    setSelectedRegulation("");
    setSubjects([]);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/college/subjects/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to delete subject");
      toast({ variant: "success", title: `${deleteTarget.name} removed` });
      await loadSubjects(selectedCourseId, selectedAcademicYear, selectedRegulation);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to delete subject" });
    } finally {
      setDeleteTarget(null);
    }
  }

  async function handleExportXlsx() {
    if (!selectedCourse) {
      toast({ variant: "destructive", title: "Select a course first" });
      return;
    }
    if (sortedSubjects.length === 0) {
      toast({ variant: "destructive", title: "No subjects to export" });
      return;
    }
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Subjects");
      sheet.columns = [
        { header: "S.No.", key: "serialNumber", width: 8 },
        { header: "Category", key: "category", width: 14 },
        { header: "Name of the Subject", key: "name", width: 32 },
        { header: "Code", key: "code", width: 14 },
        { header: "Type", key: "type", width: 12 },
        { header: "L", key: "lectureHours", width: 6 },
        { header: "T", key: "tutorialHours", width: 6 },
        { header: "P", key: "practicalHours", width: 6 },
        { header: "Credits", key: "credits", width: 10 },
        { header: "Regulation", key: "regulation", width: 14 },
        { header: "Academic Year", key: "academicYear", width: 14 },
        { header: "Hours/Week", key: "hoursPerWeek", width: 12 },
      ];
      sortedSubjects.forEach((s) => {
        sheet.addRow({
          serialNumber: s.serialNumber ?? "",
          category: s.category === "OTHER" ? (s.customCategory || "Other") : (s.category ?? ""),
          name: s.name,
          code: s.code,
          type: s.type ? SUBJECT_TYPE_LABELS[s.type] ?? s.type : "",
          lectureHours: s.lectureHours ?? "",
          tutorialHours: s.tutorialHours ?? "",
          practicalHours: s.practicalHours ?? "",
          credits: s.credits ?? "",
          regulation: s.regulation ?? "",
          academicYear: s.academicYear ?? "",
          hoursPerWeek: s.hoursPerWeek ?? "",
        });
      });
      sheet.getRow(1).font = { bold: true };
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedCourse.name}-subjects.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ variant: "success", title: "XLSX exported" });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "XLSX export failed" });
    }
  }

  async function handleExportDocx() {
    if (!selectedCourse) {
      toast({ variant: "destructive", title: "Select a course first" });
      return;
    }
    if (sortedSubjects.length === 0) {
      toast({ variant: "destructive", title: "No subjects to export" });
      return;
    }
    try {
      let blob: Blob;
      let filename = selectedCourse.name.replace(/[^a-zA-Z0-9]+/g, "-");
      try {
        const docx: any = await (eval('import("docx")') as Promise<any>);
        const { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, TextRun, HeadingLevel, AlignmentType } = docx as any;
        const headerCells = ["S.No.", "Category", "Name", "Code", "Type", "L", "T", "P", "Credits"].map(
          (h) => new TableCell({ width: { size: 100 / 9, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 16 })] })] }) as InstanceType<typeof TableCell>
        );
        const dataRows = sortedSubjects.map(
          (s) =>
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph(String(s.serialNumber ?? ""))] }),
                new TableCell({ children: [new Paragraph(s.category === "OTHER" ? (s.customCategory || "Other") : (s.category ?? ""))] }),
                new TableCell({ children: [new Paragraph(s.name)] }),
                new TableCell({ children: [new Paragraph(s.code)] }),
                new TableCell({ children: [new Paragraph(s.type ? SUBJECT_TYPE_LABELS[s.type] ?? s.type : "")] }),
                new TableCell({ children: [new Paragraph(String(s.lectureHours ?? ""))] }),
                new TableCell({ children: [new Paragraph(String(s.tutorialHours ?? ""))] }),
                new TableCell({ children: [new Paragraph(String(s.practicalHours ?? ""))] }),
                new TableCell({ children: [new Paragraph(String(s.credits ?? ""))] }),
              ],
            })
        );
        const table = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: headerCells }), ...dataRows] });
        const doc = new Document({
          sections: [
            {
              children: [
                new Paragraph({ text: selectedCourse.name, heading: HeadingLevel.HEADING_2, alignment: AlignmentType.CENTER }),
                new Paragraph({ text: `Regulation: ${selectedRegulation || allowedRegulations.join(", ") || "None"} · Academic Year: ${selectedAcademicYear}`, alignment: AlignmentType.CENTER }),
                new Paragraph({ text: "" }),
                table,
              ],
            },
          ],
        });
        const buffer = await Packer.toBlob(doc);
        blob = buffer;
        filename += ".docx";
      } catch {
        const rowsHtml = sortedSubjects
          .map(
            (s) =>
              `<tr><td>${s.serialNumber ?? ""}</td><td>${s.category === "OTHER" ? (s.customCategory || "Other") : (s.category ?? "")}</td><td>${s.name}</td><td>${s.code}</td><td>${s.type ? SUBJECT_TYPE_LABELS[s.type] ?? s.type : ""}</td><td>${s.lectureHours ?? ""}</td><td>${s.tutorialHours ?? ""}</td><td>${s.practicalHours ?? ""}</td><td>${s.credits ?? ""}</td></tr>`
          )
          .join("");
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><h2 style="text-align:center">${selectedCourse.name}</h2><table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;width:100%"><thead><tr><th>S.No.</th><th>Category</th><th>Name</th><th>Code</th><th>Type</th><th>L</th><th>T</th><th>P</th><th>Credits</th></tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`;
        blob = new Blob([html], { type: "application/msword" });
        filename += ".doc";
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({ variant: "success", title: filename.endsWith(".docx") ? "DOCX exported" : "DOC exported" });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Export failed" });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subjects"
        description="Manage subjects offered for each regulation of every course"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void handleExportXlsx()} disabled={!selectedCourseId}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />Export XLSX
            </Button>
            <Button variant="outline" onClick={() => void handleExportDocx()} disabled={!selectedCourseId}>
              <FileText className="h-4 w-4 mr-2" />Export DOCX
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="h-28 rounded-lg border bg-muted/30 animate-pulse" />
      ) : courses.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No courses have been set up for this college yet.
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="p-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Course</Label>
                <Select value={selectedCourseId} onValueChange={selectCourse} disabled={isLoadingCourses}>
                  <SelectTrigger><SelectValue placeholder={isLoadingCourses ? "Loading…" : "Select course"} /></SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Regulation</Label>
                <Select value={selectedRegulation} onValueChange={setSelectedRegulation}>
                  <SelectTrigger>
                    <SelectValue placeholder={
                      !selectedCourseId ? "Pick a course first" :
                      allowedRegulations.length === 0 ? "None assigned" :
                      selectedRegulation || "All regulations"
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedRegulations.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {selectedCourse && (
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="font-semibold text-sm flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    {selectedCourse.name}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    {showHistory && (
                      <Select value={selectedAcademicYear} onValueChange={setSelectedAcademicYear}>
                        <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Array.from(new Set([...sessionsWithSubjects, selectedAcademicYear])).sort().reverse().map((y) => (
                            <SelectItem key={y} value={y}>{y}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Button
                      size="sm"
                      variant={showHistory ? "secondary" : "outline"}
                      onClick={() => {
                        setShowHistory((v) => !v);
                        setSelectedAcademicYear(academicSessionLabel(currentAcademicStartYear()));
                      }}
                    >
                      <History className="h-4 w-4 mr-2" />History
                    </Button>
                     <Button
                       size="sm"
                       variant="outline"
                       onClick={() => void loadSubjects(selectedCourseId, selectedAcademicYear, selectedRegulation)}
                     >
                       <RefreshCw className="h-4 w-4 mr-2" />Load
                     </Button>
                     <Button
                       size="sm"
                       variant="outline"
                       onClick={() => router.push(`/academics/subjects/import?courseId=${selectedCourseId}`)}
                     >
                       <Upload className="h-4 w-4 mr-2" />Import Subjects
                     </Button>
                     <Button
                       size="sm"
                       onClick={() => router.push(`/academics/subjects/new?courseId=${selectedCourseId}&academicYear=${encodeURIComponent(selectedAcademicYear)}&regulation=${encodeURIComponent(selectedRegulation || singleRegulation)}&nextSerialNumber=${nextSerialNumber}&catalogId=${encodeURIComponent(selectedCourse.catalogId ?? "")}`)}
                     >
                      <Plus className="h-4 w-4 mr-2" />Add Subject
                    </Button>
                  </div>
                </div>

                {isLoadingSubjects ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg border bg-muted/30 animate-pulse" />)}
                  </div>
                 ) : subjects.length === 0 ? (
                   <p className="text-sm text-muted-foreground py-6 text-center">
                     {selectedRegulation
                       ? `No subjects found for ${selectedRegulation}. Add one above.`
                       : "No subjects added yet. Select a regulation above and click Load."}
                   </p>
                 ) : (
                  <>
                    <Card className="overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            <tr>
                              <th className="px-4 py-3">S.No.</th>
                              <th className="px-4 py-3">Category</th>
                              <th className="px-4 py-3">Name of the Subject</th>
                              <th className="px-4 py-3 text-center">L</th>
                              <th className="px-4 py-3 text-center">T</th>
                              <th className="px-4 py-3 text-center">P</th>
                              <th className="px-4 py-3 text-center">Credits</th>
                              <th className="px-4 py-3" />
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {paginatedSubjects.map((s) => (
                              <tr key={s.id}>
                                <td className="px-4 py-2.5">{s.serialNumber ?? "—"}</td>
                                <td className="px-4 py-2.5">
                                  {s.category ? <Badge variant="outline" className="text-xs">{s.category === "OTHER" ? (s.customCategory || "Other") : s.category}</Badge> : "—"}
                                </td>
                                <td className="px-4 py-2.5">
                                  <div className="font-medium text-foreground">{s.name}</div>
                                  <div className="flex flex-wrap items-center gap-2 mt-1">
                                    <Badge variant="secondary" className="text-xs font-mono">{s.code}</Badge>
                                    <Badge variant="outline" className="text-xs">{SUBJECT_TYPE_LABELS[s.type]}</Badge>
                                    {s.regulation && <Badge variant="secondary" className="text-xs">{s.regulation}</Badge>}
                                    {s.academicYear && <Badge variant="outline" className="text-xs">{s.academicYear}</Badge>}
                                    <span className="text-xs text-muted-foreground">{s.hoursPerWeek} hrs/week</span>
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-center">{s.lectureHours ?? "—"}</td>
                                <td className="px-4 py-2.5 text-center">{s.tutorialHours ?? "—"}</td>
                                <td className="px-4 py-2.5 text-center">{s.practicalHours ?? "—"}</td>
                                <td className="px-4 py-2.5 text-center">{s.credits}</td>
                                <td className="px-4 py-2.5 text-right">
                                  <div className="flex justify-end gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      aria-label={`Edit ${s.name}`}
                                       onClick={() => router.push(`/academics/subjects/${s.id}/edit?courseId=${selectedCourseId}&academicYear=${encodeURIComponent(selectedAcademicYear)}&regulation=${encodeURIComponent(selectedRegulation || singleRegulation)}`)}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label={`Delete ${s.name}`} onClick={() => setDeleteTarget(s)}>
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                    <Pagination
                      page={currentPage}
                      pageSize={pageSize}
                      total={sortedSubjects.length}
                      onPageChange={setCurrentPage}
                      onPageSizeChange={setPageSize}
                      disabled={isLoadingSubjects}
                    />
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name ?? "subject"}?`}
        description="This will permanently remove the subject."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
