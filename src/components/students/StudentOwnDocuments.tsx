"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FileText, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FileUpload } from "@/components/shared/FileUpload";
import { toast } from "@/hooks/useToast";
import {
  SELF_DOCUMENT_KINDS, MAX_SELF_DOCUMENTS_PER_KIND, answeredYes, type SelfDocumentKindInfo,
} from "@/lib/students/ownDocuments";
import type { StudentDocument } from "@/types";

// Supporting-document uploads for My Profile > Additional Information. A section appears only while its answer is Yes:
// "Studied Outside Andhra Pradesh?" and "Any Family ID Linked to Another State?" - nothing else is asked for here.
// `answers` is the live form value in edit mode and the stored answer in view mode (form strings: "Yes" / "No" / "").
// Uploading is its own action - it works in view and edit mode and does not go through "Save Changes". If an answer
// is changed back to No, documents already uploaded stay listed (and removable) but no new one can be added.
export function StudentOwnDocuments({ answers }: { answers: Record<string, string | undefined> }) {
  const [documents, setDocuments] = useState<StudentDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [removeTarget, setRemoveTarget] = useState<StudentDocument | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/college/student/me/documents", { cache: "no-store" });
      const body = (await res.json()) as { documents?: StudentDocument[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to load your documents");
      setDocuments((body.documents ?? []).filter((d) => d.selfUploaded === true && !!d.selfUploadKind));
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to load your documents" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function remove() {
    if (!removeTarget) return;
    try {
      const res = await fetch(`/api/college/student/me/documents/${removeTarget.id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Failed to remove the document");
      toast({ variant: "success", title: "Document removed" });
      setRemoveTarget(null);
      await load();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Network error - please try again" });
    }
  }

  const sections = SELF_DOCUMENT_KINDS
    .map((info) => ({ info, yes: answeredYes(answers[info.answerKey]), docs: documents.filter((d) => d.selfUploadKind === info.kind) }))
    // Shown while the answer is Yes, or while documents uploaded under it still exist.
    .filter((s) => s.yes || s.docs.length > 0);

  if (isLoading || sections.length === 0) return null;

  return (
    <div className="space-y-4 border-t border-border/60 pt-4">
      {sections.map(({ info, yes, docs }) => (
        <KindSection key={info.kind} info={info} canAdd={yes} docs={docs} onAdded={load} onRemove={setRemoveTarget} />
      ))}
      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Remove this document?"
        description={`"${removeTarget?.fileName ?? ""}" will be removed from your documents.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function KindSection({
  info, canAdd, docs, onAdded, onRemove,
}: { info: SelfDocumentKindInfo; canAdd: boolean; docs: StudentDocument[]; onAdded: () => Promise<void>; onRemove: (d: StudentDocument) => void }) {
  const [adding, setAdding] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const atLimit = docs.length >= MAX_SELF_DOCUMENTS_PER_KIND;

  function reset() {
    setFile(null);
    setFileKey((k) => k + 1);
    setAdding(false);
  }

  async function upload() {
    if (!file) {
      toast({ variant: "destructive", title: "Choose a file first" });
      return;
    }
    setSaving(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const up = await fetch("/api/upload/student-document", { method: "POST", body: form });
      const upBody = (await up.json().catch(() => ({}))) as { url?: string; fileName?: string; fileType?: string; fileSize?: number; error?: string };
      if (!up.ok || !upBody.url) throw new Error(upBody.error ?? "Upload failed");

      const res = await fetch("/api/college/student/me/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: info.kind, fileUrl: upBody.url, fileName: upBody.fileName ?? file.name, fileType: upBody.fileType, fileSize: upBody.fileSize }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Failed to save the document");
      toast({ variant: "success", title: "Document uploaded" });
      reset();
      await onAdded();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Network error - please try again" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-medium">{info.label}</h4>
          {canAdd && <p className="text-xs text-muted-foreground">PDF, PNG or JPEG, up to 10 MB each.</p>}
        </div>
        {canAdd && !adding && (
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)} disabled={atLimit}>
            <Plus className="mr-1.5 h-4 w-4" />Upload
          </Button>
        )}
      </div>

      {canAdd && adding && (
        <div className="space-y-3 rounded-xl border bg-muted/10 p-3">
          <FileUpload key={fileKey} onFileSelect={setFile} accept=".pdf,.png,.jpg,.jpeg" maxSizeMB={10} label="Choose file" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={reset} disabled={saving}>Cancel</Button>
            <Button type="button" size="sm" onClick={() => void upload()} loading={saving}>Upload</Button>
          </div>
        </div>
      )}

      {docs.length === 0 ? (
        !adding && <p className="text-xs text-muted-foreground">No document uploaded yet.</p>
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-xl border p-2.5">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="min-w-0 flex-1 truncate text-sm">{d.fileName}</p>
              <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <ExternalLink className="h-3.5 w-3.5" />View
              </a>
              <button type="button" onClick={() => onRemove(d)} className="rounded p-1 text-red-600 hover:bg-red-100" title="Remove document">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
