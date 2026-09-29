"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText, Plus, Trash2, Download } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FileUpload } from "@/components/shared/FileUpload";
import { toast } from "@/hooks/useToast";
import { STUDENT_DOCUMENT_TYPE_LABELS, resolveStudentDocumentTypeLabel } from "@/types";
import type { StudentDocument, StudentDocumentType } from "@/types";

export default function StudentDocumentsPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const router = useRouter();
  const [documents, setDocuments] = useState<StudentDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [documentType, setDocumentType] = useState<StudentDocumentType | "">("");
  const [customTypeLabel, setCustomTypeLabel] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StudentDocument | null>(null);

  async function loadDocuments() {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/college/students/${studentId}/documents`);
      const json = (await res.json()) as { documents?: StudentDocument[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load documents");
      setDocuments(json.documents ?? []);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to load documents" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadDocuments();
  }, [studentId]);

  function resetForm() {
    setDocumentType("");
    setCustomTypeLabel("");
    setDescription("");
    setSelectedFile(null);
  }

  async function handleSave() {
    if (!documentType || (documentType === "OTHER" && !customTypeLabel.trim()) || !selectedFile) {
      toast({ variant: "destructive", title: "Document type and a file are required" });
      return;
    }
    setIsSaving(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("studentId", studentId);
      const uploadRes = await fetch("/api/upload/student-document", { method: "POST", body: formData });
      const uploadJson = (await uploadRes.json()) as { url?: string; fileName?: string; fileType?: string; fileSize?: number; error?: string };
      if (!uploadRes.ok || !uploadJson.url) {
        toast({ variant: "destructive", title: uploadJson.error ?? "Upload failed" });
        return;
      }

      const createRes = await fetch(`/api/college/students/${studentId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType,
          ...(documentType === "OTHER" ? { customTypeLabel: customTypeLabel.trim() } : {}),
          description: description.trim(),
          fileUrl: uploadJson.url,
          fileName: uploadJson.fileName,
          fileType: uploadJson.fileType,
          fileSize: uploadJson.fileSize,
        }),
      });
      const createJson = (await createRes.json()) as { ok?: boolean; error?: string };
      if (!createRes.ok || !createJson.ok) {
        toast({ variant: "destructive", title: createJson.error ?? "Failed to save document" });
        return;
      }

      toast({ variant: "success", title: "Document uploaded" });
      setDialogOpen(false);
      resetForm();
      void loadDocuments();
    } catch {
      toast({ variant: "destructive", title: "Network error - please try again" });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/college/students/${studentId}/documents/${deleteTarget.id}`, { method: "DELETE" });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to delete document" });
        return;
      }
      toast({ variant: "success", title: "Document removed" });
      setDeleteTarget(null);
      void loadDocuments();
    } catch {
      toast({ variant: "destructive", title: "Network error - please try again" });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader title="Student Documents" description="Certificates and documents on file for this student" />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => router.push(`/college-office/students/${studentId}`)}>
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Student
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Upload Document
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="h-48 rounded-xl border bg-muted/30 animate-pulse" />
      ) : documents.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground bg-muted/10">
          <FileText className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
          <p className="font-medium text-foreground">No documents uploaded yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {documents.map((d) => (
            <Card key={d.id}>
              <CardContent className="p-4 space-y-2">
                <Badge variant="outline" className="rounded-full bg-primary/10 text-primary border-primary/20 font-medium">
                  {resolveStudentDocumentTypeLabel(d)}
                </Badge>
                {d.description && <p className="text-xs text-muted-foreground line-clamp-2">{d.description}</p>}
                <div className="flex items-center justify-between pt-2 border-t border-border/60">
                  <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary font-medium flex items-center gap-1 hover:underline">
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                  <button onClick={() => setDeleteTarget(d)} className="p-1 rounded hover:bg-red-100 text-red-600" title="Remove document">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="doc-type">Document Type</Label>
              <Select value={documentType} onValueChange={(v) => setDocumentType(v as StudentDocumentType)}>
                <SelectTrigger id="doc-type">
                  <SelectValue placeholder="Select document type" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STUDENT_DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {documentType === "OTHER" && (
              <div className="space-y-1.5">
                <Label htmlFor="doc-custom-type">Custom Document Type</Label>
                <Input id="doc-custom-type" value={customTypeLabel} onChange={(e) => setCustomTypeLabel(e.target.value)} placeholder="Specify document type" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="doc-description">Description (optional)</Label>
              <Textarea id="doc-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </div>
            <div className="space-y-1.5">
              <Label>File</Label>
              <FileUpload onFileSelect={setSelectedFile} accept=".pdf,.png,.jpg,.jpeg" maxSizeMB={10} />
              {selectedFile && <p className="text-xs text-muted-foreground">{selectedFile.name}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleSave()} loading={isSaving}>Upload</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Remove this document?"
        description={`"${deleteTarget ? resolveStudentDocumentTypeLabel(deleteTarget) : ""}" will be permanently removed.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => void handleDelete()}
      />

      <div className="pt-2">
        <Link href={`/college-office/students/${studentId}`} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          ← Back to student profile
        </Link>
      </div>
    </div>
  );
}
