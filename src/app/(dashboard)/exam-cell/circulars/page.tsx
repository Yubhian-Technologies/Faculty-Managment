"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Eye, FileText, Loader2, Megaphone, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { formatDate, formatDMY } from "@/lib/utils";
import type { Course, ExamCircular } from "@/types";

export default function ExamCellCircularsPage() {
  const [circulars, setCirculars] = useState<ExamCircular[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ExamCircular | null>(null);
  const [editTarget, setEditTarget] = useState<ExamCircular | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/college/exam-circulars");
      const data = (await res.json()) as { circulars?: ExamCircular[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setCirculars(data.circulars ?? []);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to load circulars" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void (async () => { await load(); })(); }, []);

  async function handleDelete() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/college/exam-circulars/${deleteTarget.id}`, { method: "DELETE" });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      toast({ variant: "destructive", title: data.error ?? "Failed to delete" });
      return;
    }
    toast({ variant: "success", title: "Circular removed" });
    setDeleteTarget(null);
    await load();
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Circulars"
        description="Upload a PDF/Word notice as-is, or share a short structured notice typed in directly - both land in the same list below, newest first."
        actions={
          <>
            <Button variant="outline" onClick={() => setUploadOpen(true)}><Upload className="h-4 w-4 mr-2" />Upload Circular</Button>
            <Button onClick={() => setShareOpen(true)}><Plus className="h-4 w-4 mr-2" />Share Circular</Button>
          </>
        }
      />

      {isLoading ? (
        <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}</div>
      ) : circulars.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-1">
            <p className="text-sm text-muted-foreground">No circulars uploaded yet.</p>
            <p className="text-xs text-muted-foreground">Upload a PDF or Word file to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {circulars.map((c) => {
            const isNotice = c.kind === "NOTICE";
            return (
              <Card key={c.id}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex flex-wrap items-start gap-3">
                    {isNotice ? <Megaphone className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" /> : <FileText className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" />}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-sm font-semibold truncate">{c.title}</p>
                      {isNotice ? (
                        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-[10px]">{c.courseName} · Sem {c.semester}/{c.totalSemesters}</Badge>
                          <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" />{c.noticeDate ? formatDMY(c.noticeDate) : "-"}</span>
                          <span>· {c.createdByName} · shared {formatDate(c.createdAt)}</span>
                        </p>
                      ) : (
                        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-[10px] uppercase">{c.fileType}</Badge>
                          <span>{c.fileName}</span>
                          <span>· {c.createdByName} · {formatDate(c.createdAt)}</span>
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {!isNotice && c.fileUrl && (
                        <a
                          href={c.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <Eye className="h-3.5 w-3.5" />View
                        </a>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setEditTarget(c)}>
                        <Pencil className="h-3.5 w-3.5 mr-1" />Edit
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(c)}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" />Delete
                      </Button>
                    </div>
                  </div>
                  {isNotice && <p className="text-sm whitespace-pre-wrap pl-8">{c.body}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} onDone={load} />

      <NoticeFormDialog open={shareOpen} onClose={() => setShareOpen(false)} onDone={load} />

      {editTarget && editTarget.kind === "NOTICE" && (
        <NoticeFormDialog
          key={editTarget.id}
          open
          circular={editTarget}
          onClose={() => setEditTarget(null)}
          onDone={load}
        />
      )}
      {editTarget && editTarget.kind !== "NOTICE" && (
        <EditTitleDialog key={editTarget.id} circular={editTarget} onClose={() => setEditTarget(null)} onDone={load} />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title="Remove this circular?"
        description={deleteTarget ? `"${deleteTarget.title}" will be deleted.` : undefined}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}

function UploadDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setTitle("");
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function submit() {
    if (!file) { toast({ variant: "destructive", title: "Choose a PDF or Word file" }); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (title.trim()) fd.append("title", title.trim());
      const res = await fetch("/api/college/exam-circulars", { method: "POST", body: fd });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      toast({ variant: "success", title: "Circular uploaded" });
      reset();
      onClose();
      await onDone();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Circular</DialogTitle>
          <DialogDescription>Shown exactly as uploaded - no text extraction.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Title <span className="font-normal text-muted-foreground">(optional, defaults to the file name)</span></Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Revised Exam Timetable" disabled={busy} />
          </div>
          <div className="space-y-2">
            <Label>File (PDF or Word .docx, max 10 MB)</Label>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start text-sm font-normal"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              {file ? <FileText className="h-4 w-4 mr-2 shrink-0" /> : <Upload className="h-4 w-4 mr-2 shrink-0" />}
              <span className="truncate">{file ? file.name : "Choose a file"}</span>
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || !file}>
            {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading…</> : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTitleDialog({
  circular, onClose, onDone,
}: {
  circular: ExamCircular;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [title, setTitle] = useState(circular.title);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim()) { toast({ variant: "destructive", title: "Title cannot be empty" }); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/college/exam-circulars/${circular.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      toast({ variant: "success", title: "Circular updated" });
      onClose();
      await onDone();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Circular Title</DialogTitle>
          <DialogDescription>Renaming only - re-upload to replace the file itself.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Handles both "Share Circular" (create, no `circular` prop) and editing an
// existing NOTICE circular (prefilled from `circular`) - same five fields
// either way: Course, Semester, Date, Subject, Body.
// Local calendar date, not toISOString() (that's UTC - would read as
// yesterday for anyone east of UTC late at night).
function todayISODate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function NoticeFormDialog({
  open, circular, onClose, onDone,
}: {
  open: boolean;
  circular?: ExamCircular;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const todayStr = todayISODate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseName, setCourseName] = useState(circular?.courseName ?? "");
  const [semester, setSemester] = useState(circular ? String(circular.semester) : "");
  const [noticeDate, setNoticeDate] = useState(circular?.noticeDate ?? "");
  const [subject, setSubject] = useState(circular?.subject ?? "");
  const [body, setBody] = useState(circular?.body ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const res = await fetch("/api/college/courses");
        const data = (await res.json()) as { courses?: Course[] };
        setCourses(data.courses ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load courses" });
      }
    })();
  }, [open]);

  const courseNameOptions = useMemo(() => [...new Set(courses.map((c) => c.name))].sort(), [courses]);

  // Semesters, not years - a 4-year B.Tech runs 1/8..8/8, two semesters per
  // year. There's no department dimension in this form, so this deliberately
  // doesn't scope years the way Exam Configuration does.
  const totalSemesters = useMemo(() => {
    if (circular && circular.courseName === courseName) return circular.totalSemesters;
    return Math.max(0, ...courses.filter((c) => c.name === courseName).map((c) => c.durationYears * 2));
  }, [courses, courseName, circular]);
  const semesterOptions = useMemo(() => Array.from({ length: totalSemesters || 0 }, (_, i) => i + 1), [totalSemesters]);

  function reset() {
    setCourseName("");
    setSemester("");
    setNoticeDate("");
    setSubject("");
    setBody("");
  }

  async function submit() {
    if (!courseName) { toast({ variant: "destructive", title: "Select a course" }); return; }
    if (!semester || !totalSemesters) { toast({ variant: "destructive", title: "Select a semester" }); return; }
    if (!noticeDate) { toast({ variant: "destructive", title: "Pick a date" }); return; }
    if (noticeDate < todayStr) { toast({ variant: "destructive", title: "Date cannot be in the past" }); return; }
    if (!subject.trim()) { toast({ variant: "destructive", title: "Enter a subject for the circular" }); return; }
    if (!body.trim()) { toast({ variant: "destructive", title: "Enter the circular body" }); return; }

    const courseId = courses.find((c) => c.name === courseName)?.id;
    const payload = {
      courseId, courseName, semester: Number(semester), totalSemesters,
      noticeDate, subject: subject.trim(), body: body.trim(),
    };

    setBusy(true);
    try {
      const url = circular ? `/api/college/exam-circulars/${circular.id}` : "/api/college/exam-circulars";
      const res = await fetch(url, {
        method: circular ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      toast({ variant: "success", title: circular ? "Circular updated" : "Circular shared" });
      if (!circular) reset();
      onClose();
      await onDone();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { if (!circular) reset(); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{circular ? "Edit Circular" : "Share Circular"}</DialogTitle>
          <DialogDescription>
            {circular
              ? "Update this notice - it's typed content, not a file, so every field can be edited."
              : "A short structured notice, typed in directly rather than uploaded as a file. There's no student login in this app yet, so \"share\" saves it here for now."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Course</Label>
            <Select value={courseName} onValueChange={(v) => { setCourseName(v); setSemester(""); }} disabled={busy}>
              <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
              <SelectContent>
                {courseNameOptions.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Semester</Label>
            <Select value={semester} onValueChange={setSemester} disabled={busy || !courseName}>
              <SelectTrigger><SelectValue placeholder="Select semester" /></SelectTrigger>
              <SelectContent>
                {semesterOptions.map((s) => <SelectItem key={s} value={String(s)}>{s}/{totalSemesters}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Date</Label>
            <Input type="date" min={todayStr} value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-2">
            <Label>Subject <span className="font-normal text-muted-foreground">(the circular&apos;s own heading, not a course subject)</span></Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Revised Timetable for Mid-Semester Exams" disabled={busy} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Body</Label>
            <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Notice details for students" disabled={busy} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { if (!circular) reset(); onClose(); }} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : circular ? "Save" : "Share to Students"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
