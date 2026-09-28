"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Plus, Pencil, Trash2, Upload, FileSpreadsheet, FileText, Eye, EyeOff } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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

  const [selectedAcademicYear, setSelectedAcademicYear] = useState(
    () => searchParams.get("academicYear") || academicSessionLabel(currentAcademicStartYear())
  );
  const [currentSessionLabel, setCurrentSessionLabel] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Subject | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const selectedCourseId = searchParams.get("courseId") ?? "";
  const selectedRegulation = searchParams.get("regulation") ?? "";

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

  const hasAppliedSessionRef = useRef(false);
  useEffect(() => {
    const urlAcademicYear = searchParams.get("academicYear");
    if (urlAcademicYear) {
      // The URL is authoritative whenever it names a session (deep links,
      // and the import page's own back-link) - even one that isn't current.
      setSelectedAcademicYear(urlAcademicYear);
      return;
    }
    if (hasAppliedSessionRef.current || !currentSessionLabel) return;
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

  function selectCourse(courseId: string) {
    const course = courses.find((c) => c.id === courseId);
    const catalogItem = catalogItems.find((ci) => ci.id === course?.catalogId);
    const regs = catalogItem?.regulations ?? [];
    const regulation = regs.length > 0 ? regs[0] : "";
    const newAcademicYear = searchParams.get("academicYear") ?? academicSessionLabel(currentAcademicStartYear());
    router.push(`/academics/subjects?courseId=${courseId}&regulation=${encodeURIComponent(regulation)}${newAcademicYear ? `&academicYear=${encodeURIComponent(newAcademicYear)}` : ""}`);
  }

  function selectRegulation(regulation: string) {
    const newAcademicYear = searchParams.get("academicYear") ?? academicSessionLabel(currentAcademicStartYear());
    router.push(`/academics/subjects?courseId=${selectedCourseId}&regulation=${encodeURIComponent(regulation)}${newAcademicYear ? `&academicYear=${encodeURIComponent(newAcademicYear)}` : ""}`);
  }

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

  // Master subjects are course+regulation scoped, shared by every department
  // that teaches this catalog course - not owned by whichever department's
  // Course doc happens to be `courseId` (see /api/college/subjects GET's own
  // doc-comment). Queried by `catalogId` so the list is the same regardless
  // of which department's doc `courseId` (still needed to file a NEW subject
  // against a real Course doc, below) resolves to. Falls back to `courseId`
  // only for the rare legacy Course doc with no catalogId set.
  const loadSubjects = useCallback(async (courseId: string, academicYear: string, regulation: string, catalogId?: string) => {
    if (!courseId || !regulation) { setSubjects([]); return; }
    setIsLoadingSubjects(true);
    try {
      const scopeParam = catalogId ? `catalogId=${encodeURIComponent(catalogId)}` : `courseId=${encodeURIComponent(courseId)}`;
      const regulationParam = `&regulation=${encodeURIComponent(regulation)}`;
      const res = await fetch(
        `/api/college/subjects?${scopeParam}${regulationParam}${academicYear ? `&academicYear=${encodeURIComponent(academicYear)}` : ""}`
      );
      const data = await res.json() as { subjects: Subject[] };
      setSubjects(data.subjects ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load subjects" });
    } finally {
      setIsLoadingSubjects(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCourseId && selectedRegulation) {
      void loadSubjects(selectedCourseId, selectedAcademicYear, selectedRegulation, selectedCourse?.catalogId);
    } else {
      setSubjects([]);
    }
  }, [selectedCourseId, selectedAcademicYear, selectedRegulation, selectedCourse, loadSubjects]);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/college/subjects/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to delete subject");
      toast({ variant: "success", title: `${deleteTarget.name} removed` });
      await loadSubjects(selectedCourseId, selectedAcademicYear, selectedRegulation, selectedCourse?.catalogId);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to delete subject" });
    } finally {
      setDeleteTarget(null);
    }
  }

  async function handleToggleActive(subject: Subject) {
    try {
      const res = await fetch(`/api/college/subjects/${subject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !subject.isActive }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to update subject");
      toast({ variant: "success", title: `${subject.name} ${subject.isActive ? "deactivated" : "activated"}` });
      await loadSubjects(selectedCourseId, selectedAcademicYear, selectedRegulation, selectedCourse?.catalogId);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to update subject" });
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

  const exportDisabledReason = !selectedCourseId ? "Select a course first" : !selectedRegulation ? "Select a regulation first" : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subjects"
        description="Manage subjects offered for each regulation of every course"
        actions={
          <div className="flex gap-2 flex-wrap">
            <span title={exportDisabledReason} aria-label={exportDisabledReason}>
              <Button
                variant="outline"
                onClick={() => void handleExportXlsx()}
                disabled={!!exportDisabledReason}
                aria-disabled={!!exportDisabledReason}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" aria-hidden="true" />Export XLSX
              </Button>
            </span>
            <span title={exportDisabledReason} aria-label={exportDisabledReason}>
              <Button
                variant="outline"
                onClick={() => void handleExportDocx()}
                disabled={!!exportDisabledReason}
                aria-disabled={!!exportDisabledReason}
              >
                <FileText className="h-4 w-4 mr-2" aria-hidden="true" />Export DOCX
              </Button>
            </span>
            <Button variant="outline" onClick={() => router.push(`/academics/subjects/import?courseId=${selectedCourseId}&regulation=${encodeURIComponent(selectedRegulation)}`)}>
              <Upload className="h-4 w-4 mr-2" aria-hidden="true" />Import Subjects
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
            <CardContent className="p-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="subject-course-select" className="flex items-center gap-1.5">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0" aria-hidden="true">1</span>
                  Course
                </Label>
                <Select value={selectedCourseId} onValueChange={selectCourse}>
                  <SelectTrigger id="subject-course-select" aria-label="Select course">
                    <SelectValue placeholder="Select a course" />
                  </SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="subject-regulation-select" className="flex items-center gap-1.5">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0" aria-hidden="true">2</span>
                  Regulation
                </Label>
                <Select
                  value={selectedRegulation}
                  onValueChange={selectRegulation}
                  disabled={!selectedCourseId || allowedRegulations.length === 0}
                >
                  <SelectTrigger id="subject-regulation-select" aria-label="Select regulation">
                    <SelectValue placeholder={
                      !selectedCourseId ? "Select a course first" :
                      allowedRegulations.length === 0 ? "No regulations assigned to this course" :
                      "Select a regulation"
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedRegulations.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!selectedCourseId && (
                  <p className="text-[11px] text-muted-foreground">Select a course above to see available regulations.</p>
                )}
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
                      <Button
                        size="sm"
                        onClick={() => router.push(`/academics/subjects/new?courseId=${selectedCourseId}&academicYear=${encodeURIComponent(selectedAcademicYear)}&regulation=${encodeURIComponent(selectedRegulation)}&nextSerialNumber=${nextSerialNumber}&catalogId=${encodeURIComponent(selectedCourse.catalogId ?? "")}`)}
                        disabled={!selectedCourseId || !selectedRegulation}
                      >
                       <Plus className="h-4 w-4 mr-2" />Add Subject
                      </Button>
                    </div>
                </div>

                {isLoadingSubjects ? (
                  <div className="space-y-2" aria-label="Loading subjects" aria-busy="true">
                    {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg border bg-muted/30 animate-pulse" />)}
                  </div>
                 ) : subjects.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-8 text-center">
                      <BookOpen className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
                      <p className="text-sm font-medium text-muted-foreground">
                        {!selectedRegulation
                          ? "Select a regulation above to view and add subjects."
                          : allowedRegulations.length === 0
                          ? "No regulations have been configured for this course in Course Catalog."
                          : `No subjects found for ${selectedRegulation}.`}
                      </p>
                      {selectedRegulation && allowedRegulations.length > 0 && (
                        <p className="text-xs text-muted-foreground">Use the &quot;Add Subject&quot; button above to get started.</p>
                      )}
                    </div>
                  ) : (
                   <>
                     <Card className="overflow-hidden">
                       <div className="overflow-x-auto">
                         <table className="w-full text-sm" aria-label={`Subjects for ${selectedCourse?.name ?? "selected course"}`}>
                           <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                             <tr>
                               <th scope="col" className="px-4 py-3">S.No.</th>
                               <th scope="col" className="px-4 py-3">Category</th>
                               <th scope="col" className="px-4 py-3">Name of the Subject</th>
                               <th scope="col" className="px-4 py-3 text-center" title="Lecture hours">L</th>
                               <th scope="col" className="px-4 py-3 text-center" title="Tutorial hours">T</th>
                               <th scope="col" className="px-4 py-3 text-center" title="Practical hours">P</th>
                               <th scope="col" className="px-4 py-3 text-center">Credits</th>
                               <th scope="col" className="px-4 py-3 sr-only">Actions</th>
                             </tr>
                           </thead>
                           <tbody className="divide-y">
                             {paginatedSubjects.map((s) => (
                                <tr key={s.id} className={!s.isActive ? "opacity-60 bg-muted/20" : undefined}>
                                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{s.serialNumber ?? "—"}</td>
                                  <td className="px-4 py-3">
                                    {s.category ? <Badge variant="outline" className="text-xs whitespace-nowrap">{s.category === "OTHER" ? (s.customCategory || "Other") : s.category}</Badge> : <span className="text-muted-foreground">—</span>}
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="font-medium text-foreground flex items-center gap-2">{s.name}{!s.isActive && <Badge variant="secondary" className="text-[10px] font-normal">Inactive</Badge>}</div>
                                    <div className="flex flex-wrap items-center gap-2 mt-1">
                                      <Badge variant="secondary" className="text-xs font-mono">{s.code}</Badge>
                                      {s.shortCode && <Badge variant="outline" className="text-xs font-mono">{s.shortCode}</Badge>}
                                      <Badge variant="outline" className="text-xs">{SUBJECT_TYPE_LABELS[s.type] ?? s.type ?? "—"}</Badge>
                                      {s.hoursPerWeek != null && <span className="text-xs text-muted-foreground">{s.hoursPerWeek} hrs/wk</span>}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-center tabular-nums">{s.lectureHours ?? "—"}</td>
                                  <td className="px-4 py-3 text-center tabular-nums">{s.tutorialHours ?? "—"}</td>
                                  <td className="px-4 py-3 text-center tabular-nums">{s.practicalHours ?? "—"}</td>
                                  <td className="px-4 py-3 text-center tabular-nums font-medium">{s.credits}</td>
                                  <td className="px-4 py-3 text-right">
                                    <div className="flex justify-end gap-1">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9"
                                        aria-label={`Edit ${s.name}`}
                                        title={`Edit ${s.name}`}
                                        onClick={() => router.push(`/academics/subjects/${s.id}/edit?courseId=${encodeURIComponent(selectedCourseId)}&catalogId=${encodeURIComponent(selectedCourse?.catalogId ?? "")}&academicYear=${encodeURIComponent(selectedAcademicYear)}&regulation=${encodeURIComponent(selectedRegulation || s.regulation || "")}`)}
                                      >
                                        <Pencil className="h-4 w-4" aria-hidden="true" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9"
                                        aria-label={s.isActive ? `Deactivate ${s.name}` : `Activate ${s.name}`}
                                        title={s.isActive ? `Deactivate ${s.name}` : `Activate ${s.name}`}
                                        onClick={() => void handleToggleActive(s)}
                                      >
                                        {s.isActive
                                          ? <EyeOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                          : <Eye className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9 text-destructive hover:text-destructive"
                                        aria-label={`Delete ${s.name}`}
                                        title={`Delete ${s.name}`}
                                        onClick={() => setDeleteTarget(s)}
                                      >
                                        <Trash2 className="h-4 w-4" aria-hidden="true" />
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
