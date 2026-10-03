"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Layers, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Pagination } from "@/components/shared/Pagination";
import { toast } from "@/hooks/useToast";
import type { Section, StudentRecord } from "@/types";

const ALL_SECTIONS = "ALL";
const ALL_BATCHES = "ALL";
const DEFAULT_PAGE_SIZE = 20;

export default function StudentsPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sectionFilter, setSectionFilter] = useState(ALL_SECTIONS);
  // Batches are scoped per section (see panel/students/batches/page.tsx), so
  // this only ever applies once a specific section is picked above - reset
  // whenever that changes, same as picking "All Sections" clears it too.
  const [batchFilter, setBatchFilter] = useState(ALL_BATCHES);

  const [editTarget, setEditTarget] = useState<StudentRecord | null>(null);
  const [editLabBatch, setEditLabBatch] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // The roster is paged server-side (panelPagedList.ts) and only fetched when
  // Load is pressed, so opening this page - or just changing a dropdown - reads
  // nothing. `sectionFilter`/`batchFilter` are the dropdown picks; `applied` is
  // what the last Load actually fetched.
  const [applied, setApplied] = useState<{ section: string; batch: string } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  // Pages already fetched (revisiting one costs no reads) and the cursor that
  // starts each page (the one after a fetched page is a cheap `limit` read; a
  // page with no cursor is reached by offset - see panelPagedList.ts).
  const pageCache = useRef(new Map<number, StudentRecord[]>());
  const pageCursors = useRef(new Map<number, string>());
  // The batch dropdown can only offer labels from students fetched so far -
  // reset when the section changes.
  const [batchLabels, setBatchLabels] = useState<string[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(true);
  const requestSeq = useRef(0);
  // Set only when the API answered with its plain, unpaged `{ students }` list
  // (an account that also holds another seat - HOD, Principal, ... - is
  // resolved to that role by the endpoint, not the faculty-in-charge branch
  // that pages). Everything is then paged here in the browser instead, so the
  // controls behave the same; it just can't save reads server-side.
  const fullList = useRef<StudentRecord[] | null>(null);

  useEffect(() => {
    fetch("/api/college/sections")
      .then((r) => r.json() as Promise<{ sections: Section[] }>)
      .then((d) => setSections(d.sections ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load students" }))
      .finally(() => setSectionsLoading(false));
  }, []);

  function resetPages() {
    pageCache.current.clear();
    pageCursors.current.clear();
    fullList.current = null;
  }

  // Client-side paging over `fullList` (see above): section/batch filters are
  // applied here too, since the unpaged response ignored them.
  function showFallbackPage(p: number, filters: { section: string; batch: string }, size: number) {
    const sec = sections.find((x) => x.id === filters.section);
    const inSection = (fullList.current ?? []).filter((s) =>
      !sec || ((s.department === sec.department || s.secondaryDepartment === sec.department) && s.section === sec.name && s.year === sec.year)
    );
    const matching = filters.batch === ALL_BATCHES ? inSection : inSection.filter((s) => (s.labBatch ?? "").trim() === filters.batch);
    const lastPage = Math.max(1, Math.ceil(matching.length / size));
    const at = Math.min(p, lastPage);
    setTotal(matching.length);
    setStudents(matching.slice((at - 1) * size, at * size));
    setPage(at);
    const labels = inSection.map((s) => s.labBatch?.trim()).filter((v): v is string => !!v);
    if (labels.length > 0) setBatchLabels((prev) => Array.from(new Set([...prev, ...labels])).sort());
  }

  async function fetchPage(p: number, filters: { section: string; batch: string }, size: number) {
    if (fullList.current) {
      showFallbackPage(p, filters, size);
      return;
    }
    const cached = pageCache.current.get(p);
    if (cached) {
      setStudents(cached);
      setPage(p);
      return;
    }
    const seq = ++requestSeq.current;
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ paged: "1", limit: String(size), pageNo: String(p) });
      if (filters.section !== ALL_SECTIONS) params.set("sectionId", filters.section);
      if (filters.batch !== ALL_BATCHES) params.set("labBatch", filters.batch);
      const cursor = pageCursors.current.get(p);
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/college/students?${params}`);
      const d = await res.json() as { students?: StudentRecord[]; nextCursor?: string | null; total?: number | null; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Failed to load students");
      if (seq !== requestSeq.current) return; // a newer Load / page request superseded this one
      const incoming = d.students ?? [];
      if (typeof d.total !== "number") {
        fullList.current = incoming;
        showFallbackPage(p, filters, size);
        return;
      }
      pageCache.current.set(p, incoming);
      if (d.nextCursor) pageCursors.current.set(p + 1, d.nextCursor);
      if (typeof d.total === "number") setTotal(d.total);
      setStudents(incoming);
      setPage(p);
      const labels = incoming.map((s) => s.labBatch?.trim()).filter((v): v is string => !!v);
      if (labels.length > 0) setBatchLabels((prev) => Array.from(new Set([...prev, ...labels])).sort());
    } catch {
      if (seq === requestSeq.current) toast({ variant: "destructive", title: "Failed to load students" });
    } finally {
      if (seq === requestSeq.current) setIsLoading(false);
    }
  }

  function handleLoad() {
    const filters = { section: sectionFilter, batch: batchFilter };
    resetPages();
    setApplied(filters);
    fetchPage(1, filters, pageSize);
  }

  function handlePageSizeChange(size: number) {
    setPageSize(size);
    if (!applied) return;
    resetPages();
    fetchPage(1, applied, size);
  }

  // The API already scopes `students` to exactly the faculty's in-charge
  // sections (department + section + year) - this is a defense-in-depth
  // re-check, not the primary authorization boundary. A shared-first-year
  // student in one of these sections stays filed under their common
  // department until promotion, with secondaryDepartment naming the
  // section's real branch instead (see students/[id] PATCH) - check both.
  const inChargeKeys = new Set(sections.map((s) => `${s.department}::${s.name}::${s.year}`));
  const authorizedStudents = students.filter((s) =>
    inChargeKeys.has(`${s.department}::${s.section}::${s.year}`)
    || inChargeKeys.has(`${s.secondaryDepartment ?? ""}::${s.section}::${s.year}`)
  );

  const selectedSection = sections.find((s) => s.id === sectionFilter);
  const appliedSection = sections.find((s) => s.id === applied?.section);
  const sectionStudents = appliedSection
    ? authorizedStudents.filter(
        (s) => (s.department === appliedSection.department || s.secondaryDepartment === appliedSection.department)
          && s.section === appliedSection.name && s.year === appliedSection.year
      )
    : authorizedStudents;

  // Every lab-batch label actually in use within the selected section (see
  // StudentRecord.labBatch's own doc-comment) - only offered once a specific
  // section is picked, since a batch label only means something within one
  // section's own split lab periods (the same label in a different section
  // is an unrelated coincidence, not the same batch).
  const batchOptions = selectedSection ? batchLabels : [];
  // Section and batch are already applied server-side - sectionStudents is
  // just the defense-in-depth re-check of that page.
  const visibleStudents = sectionStudents;

  // Existing lab-batch labels already in use in this student's own section -
  // offered as datalist suggestions so a second student gets typed in as
  // exactly "Batch 1" again rather than a near-miss that would silently
  // exclude them from that batch's attendance roster (see sectionRoster.ts).
  const editLabBatchSuggestions = useMemo(() => {
    if (!editTarget) return [];
    const labels = authorizedStudents
      .filter((s) => s.department === editTarget.department && s.section === editTarget.section && s.year === editTarget.year)
      .map((s) => (s.labBatch as string | undefined)?.trim())
      .filter((v): v is string => !!v);
    return Array.from(new Set(labels)).sort();
  }, [editTarget, authorizedStudents]);

  function openEdit(student: StudentRecord) {
    setEditTarget(student);
    setEditLabBatch((student.labBatch as string | undefined) ?? "");
  }

  async function saveLabBatch() {
    if (!editTarget) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/college/students/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labBatch: editLabBatch.trim() }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to update lab batch");
      toast({ title: "Lab batch updated" });
      // Patched in place - re-fetching the roster for one field is a page of
      // reads for nothing. A row that no longer matches the applied batch
      // filter drops out, which shifts every page boundary, so the other
      // cached pages are discarded.
      const newBatch = editLabBatch.trim();
      const targetId = editTarget.id;
      if (fullList.current && applied) {
        fullList.current = fullList.current.map((s) => (s.id === editTarget.id ? { ...s, labBatch: newBatch || undefined } : s));
        showFallbackPage(page, applied, pageSize);
      } else if (applied && applied.batch !== ALL_BATCHES && newBatch !== applied.batch) {
        setStudents((prev) => prev.filter((s) => s.id !== targetId));
        setTotal((t) => Math.max(0, t - 1));
        resetPages();
      } else {
        const patch = (rows: StudentRecord[]) => rows.map((s) => (s.id === targetId ? { ...s, labBatch: newBatch || undefined } : s));
        setStudents(patch);
        for (const [p, rows] of pageCache.current) pageCache.current.set(p, patch(rows));
      }
      if (newBatch) setBatchLabels((prev) => (prev.includes(newBatch) ? prev : [...prev, newBatch].sort()));
      setEditTarget(null);
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to update lab batch", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsSaving(false);
    }
  }

  function handleSectionFilterChange(value: string) {
    setSectionFilter(value);
    setBatchFilter(ALL_BATCHES);
    setBatchLabels([]);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description="Roster for your assigned sections"
      />

      {!isLoading && !sectionsLoading && sections.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            You are not currently in charge of any section. Ask your HOD to assign you as the faculty-in-charge for a section.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3 space-y-3">
            <CardTitle className="text-base">Roster{applied ? ` (${total})` : ""}</CardTitle>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-2 sm:max-w-xs">
                <Label>Section</Label>
                <Select value={sectionFilter} onValueChange={handleSectionFilterChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_SECTIONS}>All Sections</SelectItem>
                    {sections.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name} (Year {s.year})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Batch only means something within one section's own split lab
                  periods - only offered once a specific section is picked
                  above, never across "All Sections". */}
              {selectedSection && batchOptions.length > 0 && (
                <div className="space-y-2 sm:max-w-xs">
                  <Label>Batch</Label>
                  <Select value={batchFilter} onValueChange={setBatchFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_BATCHES}>All Batches</SelectItem>
                      {batchOptions.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {selectedSection && applied?.section === sectionFilter && batchOptions.length === 0 && total <= pageSize && (
                <Link href="/panel/students/batches" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 pb-2">
                  <Layers className="h-3.5 w-3.5" />No lab batches set up for this section yet - add some
                </Link>
              )}
              <Button type="button" onClick={handleLoad} disabled={isLoading || sectionsLoading}>
                {isLoading ? "Loading…" : "Load"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading || sectionsLoading ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}</div>
            ) : !applied ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Pick a section (and batch, if any), then press Load to view students.
              </p>
            ) : visibleStudents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {applied.batch !== ALL_BATCHES
                  ? `No students in ${applied.batch}.`
                  : appliedSection ? "No students in this section yet." : "No students in your assigned sections yet."}
              </p>
            ) : (
              <div className="divide-y">
                {visibleStudents.map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.rollNumber} · Section {s.section} · Year {s.year}
                        {s.labBatch ? ` · ${s.labBatch}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={s.status === "REGULAR" ? "default" : s.status === "GRADUATED" ? "secondary" : "destructive"} className="text-xs">
                        {s.status === "REGULAR" ? "Regular" : s.status === "GRADUATED" ? "Graduated" : "Detained"}
                      </Badge>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(s)} title="Set lab batch">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {applied && total > 0 && sections.length > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(p) => fetchPage(p, applied, pageSize)}
          onPageSizeChange={handlePageSizeChange}
          disabled={isLoading}
        />
      )}

      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lab Batch — {editTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="edit-lab-batch">Lab Batch</Label>
            <Input
              id="edit-lab-batch"
              list="edit-lab-batch-suggestions"
              value={editLabBatch}
              onChange={(e) => setEditLabBatch(e.target.value)}
              placeholder="e.g. Batch 1"
              autoComplete="off"
            />
            <datalist id="edit-lab-batch-suggestions">
              {editLabBatchSuggestions.map((label) => <option key={label} value={label} />)}
            </datalist>
            <p className="text-xs text-muted-foreground">
              Which split-lab sub-group this student sits in for a PRACTICAL subject - must match the batch
              label on the Timetable exactly. Leave blank if this section&rsquo;s labs aren&rsquo;t split.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button type="button" onClick={saveLabBatch} disabled={isSaving}>{isSaving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
