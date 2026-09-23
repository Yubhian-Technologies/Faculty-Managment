"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, FileText, Loader2, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { ExamGuideline } from "@/types";

export default function ExamCellGuidelinesPage() {
  const [guidelines, setGuidelines] = useState<ExamGuideline[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ExamGuideline | null>(null);
  const [editTarget, setEditTarget] = useState<ExamGuideline | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/college/exam-guidelines");
      const data = (await res.json()) as { guidelines?: ExamGuideline[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setGuidelines(data.guidelines ?? []);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to load guidelines" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void (async () => { await load(); })(); }, []);

  async function handleDelete() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/college/exam-guidelines/${deleteTarget.id}`, { method: "DELETE" });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      toast({ variant: "destructive", title: data.error ?? "Failed to delete" });
      return;
    }
    toast({ variant: "success", title: "Guideline document removed" });
    setDeleteTarget(null);
    await load();
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Exam Cell Guidelines"
        description="Upload a PDF or Word document and its text is automatically split into a point-wise list below - a best-effort read of whatever the file contains, so review it after uploading."
        actions={<Button onClick={() => setUploadOpen(true)}><Plus className="h-4 w-4 mr-2" />Upload Guidelines</Button>}
      />

      {isLoading ? (
        <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-40 bg-muted animate-pulse rounded-lg" />)}</div>
      ) : guidelines.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-1">
            <p className="text-sm text-muted-foreground">No guideline documents uploaded yet.</p>
            <p className="text-xs text-muted-foreground">Upload a PDF or Word file to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {guidelines.map((g) => (
            <Card key={g.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
                <div className="min-w-0 space-y-1">
                  <CardTitle className="text-base">{g.title}</CardTitle>
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-[10px] uppercase">{g.fileType}</Badge>
                    <span>{g.fileName}</span>
                    <span>· {g.createdByName} · {formatDate(g.createdAt)}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <a
                    href={g.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Eye className="h-3.5 w-3.5" />View original
                  </a>
                  <Button size="sm" variant="ghost" onClick={() => setEditTarget(g)}>
                    <Pencil className="h-3.5 w-3.5 mr-1" />Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(g)}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" />Delete
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {g.points.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} onDone={load} />

      {editTarget && (
        <EditDialog key={editTarget.id} guideline={editTarget} onClose={() => setEditTarget(null)} onDone={load} />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title="Remove this guideline document?"
        description={deleteTarget ? `"${deleteTarget.title}" and its extracted points will be deleted.` : undefined}
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
      const res = await fetch("/api/college/exam-guidelines", { method: "POST", body: fd });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      toast({ variant: "success", title: "Guidelines uploaded and extracted" });
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
          <DialogTitle>Upload Guidelines</DialogTitle>
          <DialogDescription>
            The file&apos;s text is extracted automatically and split into points below - it&apos;s a best-effort
            reading of the document, not a guaranteed clean bullet list, so check the result after uploading.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Title <span className="font-normal text-muted-foreground">(optional, defaults to the file name)</span></Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Semester End Exam Guidelines" disabled={busy} />
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

function EditDialog({
  guideline, onClose, onDone,
}: {
  guideline: ExamGuideline;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [title, setTitle] = useState(guideline.title);
  const [pointsText, setPointsText] = useState(guideline.points.join("\n"));
  const [busy, setBusy] = useState(false);

  async function submit() {
    const points = pointsText.split("\n").map((p) => p.trim()).filter((p) => p.length > 0);
    if (!title.trim()) { toast({ variant: "destructive", title: "Title cannot be empty" }); return; }
    if (points.length === 0) { toast({ variant: "destructive", title: "Add at least one point" }); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/college/exam-guidelines/${guideline.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), points }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      toast({ variant: "success", title: "Guideline updated" });
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
          <DialogTitle>Edit Guidelines</DialogTitle>
          <DialogDescription>
            Fix up the auto-extracted points below - one per line. This only edits the list here; it doesn&apos;t
            change or re-parse the uploaded file (re-upload to replace that).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-2">
            <Label>Points <span className="font-normal text-muted-foreground">(one per line)</span></Label>
            <Textarea rows={10} value={pointsText} onChange={(e) => setPointsText(e.target.value)} disabled={busy} />
          </div>
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
