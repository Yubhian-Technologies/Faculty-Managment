"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Plus, Pencil, Trash2, Upload, FileSpreadsheet, FileText, Search, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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

  const [selectedAcademicYear, setSelectedAcademicYear] = useState(academicSessionLabel(currentAcademicStartYear()));
  const [currentSessionLabel, setCurrentSessionLabel] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Subject | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchText, setSearchText] = useState("");

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

  const filteredSubjects = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return sortedSubjects;
    return sortedSubjects.filter((s) => {
      const haystack = [
        s.name,
        s.code,
        s.shortCode,
        s.category === "OTHER" ? (s.customCategory || "Other") : s.category,
        s.type ? SUBJECT_TYPE_LABELS[s.type] ?? s.type : undefined,
        s.regulation,
        s.academicYear,
        s.courseName,
        s.department,
        s.credits,
        s.hoursPerWeek,
        s.lectureHours,
        s.tutorialHours,
        s.practicalHours,
        s.semester,
        s.year,
        s.serialNumber,
      ]
        .filter((v) => v !== undefined && v !== null)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [sortedSubjects, searchText]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchText, selectedCourseId, selectedRegulation]);

  const totalPages = Math.max(1, Math.ceil(filteredSubjects.length / pageSize));
  const paginatedSubjects = filteredSubjects.slice((currentPage - 1) * pageSize, currentPage * pageSize);

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
            <Button variant="outline" onClick={() => void handleExportXlsx()} disabled={!selectedCourseId || !selectedRegulation}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />Export XLSX
            </Button>
            <Button variant="outline" onClick={() => void handleExportDocx()} disabled={!selectedCourseId || !selectedRegulation}>
              <FileText className="h-4 w-4 mr-2" />Export DOCX
            </Button>
            <Button variant="outline" onClick={() => router.push(`/academics/subjects/import?courseId=${selectedCourseId}&regulation=${encodeURIComponent(selectedRegulation)}`)}>
              <Upload className="h-4 w-4 mr-2" />Import Subjects
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
            <CardContent className="p-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Course</Label>
                <Select value={selectedCourseId} onValueChange={selectCourse}>
                  <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Regulation</Label>
                <Select
                  value={selectedRegulation}
                  onValueChange={selectRegulation}
                  disabled={!selectedCourseId || allowedRegulations.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={
                      !selectedCourseId ? "Pick a course first" :
                      allowedRegulations.length === 0 ? "No regulations assigned" :
                      "Select regulation"
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
                      <Button
                        size="sm"
                        onClick={() => router.push(`/academics/subjects/new?courseId=${selectedCourseId}&academicYear=${encodeURIComponent(selectedAcademicYear)}&regulation=${encodeURIComponent(selectedRegulation)}&nextSerialNumber=${nextSerialNumber}&catalogId=${encodeURIComponent(selectedCourse.catalogId ?? "")}`)}
                        disabled={!selectedCourseId || !selectedRegulation}
                      >
                       <Plus className="h-4 w-4 mr-2" />Add Subject
                      </Button>
                    </div>
                </div>

                {subjects.length > 0 && (
                  <div className="relative max-w-sm">
                    <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      placeholder="Search subjects by name, code, category, type…"
                      className="pl-8 pr-8 h-9"
                    />
                    {searchText && (
                      <button
                        type="button"
                        onClick={() => setSearchText("")}
                        aria-label="Clear search"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {isLoadingSubjects ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg border bg-muted/30 animate-pulse" />)}
                  </div>
                 ) : subjects.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-6 text-center">
                      {!selectedRegulation
                        ? "Select a regulation above to view and add subjects."
                        : allowedRegulations.length === 0
                        ? "No regulations have been configured for this course in Course Catalog."
                        : `No subjects found for ${selectedRegulation}. Add one above.`}
                    </p>
                  ) : filteredSubjects.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-6 text-center">
                      No subjects match &ldquo;{searchText}&rdquo;.
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
                                     {s.shortCode && <Badge variant="outline" className="text-xs font-mono">{s.shortCode}</Badge>}
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
                                        onClick={() => router.push(`/academics/subjects/${s.id}/edit?courseId=${encodeURIComponent(selectedCourseId)}&catalogId=${encodeURIComponent(selectedCourse?.catalogId ?? "")}&academicYear=${encodeURIComponent(selectedAcademicYear)}&regulation=${encodeURIComponent(selectedRegulation || s.regulation || "")}`)}
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
                       total={filteredSubjects.length}
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
