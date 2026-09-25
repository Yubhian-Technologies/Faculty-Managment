"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { FileUpload } from "@/components/shared/FileUpload";
import type { EmployeeScope, CircularRecipientKind } from "@/types/circular";

const STUDENT_YEARS = [1, 2, 3, 4];

export function CircularForm({ onCreated }: { onCreated?: (id: string) => void }) {
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [messageFromOptions, setMessageFromOptions] = useState<string[]>(["Management", "Principal", "Dean", "HOD"]);
  const [recipientKind, setRecipientKind] = useState<CircularRecipientKind>("STAFF");
  const [employeeType, setEmployeeType] = useState<EmployeeScope>("ALL");
  const [targetYears, setTargetYears] = useState<number[]>([]);
  const [deptIds, setDeptIds] = useState<string[]>([]);
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [messageFrom, setMessageFrom] = useState<string>("Principal");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachment, setAttachment] = useState<{ fileName: string; fileUrl: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/college/circular-settings").then((r) => r.json()).then((j) => { if (j.settings?.messageFromOptions?.length) setMessageFromOptions(j.settings.messageFromOptions); }).catch(() => {});
    fetch("/api/college/departments").then((r) => r.json()).then((j) => setDepartments(j.departments ?? j.data ?? [])).catch(() => {});
    fetch("/api/college/sections").then((r) => r.json()).then((j) => {
      // fallback for colleges without departments collection populated — derive from sections
      if (departments.length === 0 && j.sections) {
        const map = new Map<string, string>();
        for (const s of j.sections) if (s.department) map.set(s.department, s.department);
        if (map.size) setDepartments(Array.from(map.entries()).map(([id, name]) => ({ id, name })));
      }
    }).catch(() => {});
  }, []);

  async function handleSave(publish: boolean) {
    if (!subject.trim() || !body.trim()) { toast({ variant: "destructive", title: "Subject and body are required" }); return; }
    setSaving(true);
    try {
      let uploaded: { fileName: string; fileUrl: string } | null = attachment;
      if (attachmentFile) {
        const fd = new FormData();
        fd.append("file", attachmentFile);
        const up = await fetch("/api/upload/circular", { method: "POST", body: fd });
        const uj = await up.json() as { url?: string; fileName?: string; error?: string };
        if (!up.ok) throw new Error(uj.error ?? "Upload failed");
        uploaded = { fileName: attachmentFile.name, fileUrl: uj.url! };
      }
      const selectedDeptNames = deptIds.map((id) => departments.find((d) => d.id === id)?.name ?? id);
      const res = await fetch("/api/college/circulars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject, body, date, employeeType, departmentIds: deptIds, departmentNames: selectedDeptNames, messageFrom,
          recipientKind, targetYears: recipientKind === "STUDENTS" ? targetYears : [],
          attachments: uploaded ? [uploaded] : [],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      const id = json.circular.id as string;
      if (publish) {
        const pr = await fetch(`/api/college/circulars/${id}/publish`, { method: "POST" });
        const pj = await pr.json();
        if (!pr.ok) throw new Error(pj.error ?? "Publish failed");
        toast({ variant: "success", title: "Circular published and notified" });
      } else {
        toast({ variant: "success", title: "Circular saved as draft" });
      }
      onCreated?.(id);
      setSubject(""); setBody(""); setAttachment(null); setAttachmentFile(null);
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed" }); }
    finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>New Circular</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label>Recipients</Label>
            <Select value={recipientKind} onValueChange={(v) => setRecipientKind(v as CircularRecipientKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="STAFF">Faculty / Staff</SelectItem><SelectItem value="STUDENTS">Students</SelectItem></SelectContent>
            </Select>
          </div>
          {recipientKind === "STAFF" ? (
            <div>
              <Label>Employee type</Label>
              <Select value={employeeType} onValueChange={(v) => setEmployeeType(v as EmployeeScope)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ALL">All</SelectItem><SelectItem value="TEACHING">Teaching</SelectItem><SelectItem value="NON_TEACHING">Non-Teaching</SelectItem></SelectContent>
              </Select>
            </div>
          ) : (
            <div>
              <Label>Academic year (empty = all)</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {STUDENT_YEARS.map((y) => (
                  <label key={y} className="flex items-center gap-1.5 rounded border px-2 py-1 text-sm">
                    <input type="checkbox" checked={targetYears.includes(y)} onChange={(e) => setTargetYears((prev) => e.target.checked ? [...prev, y] : prev.filter((x) => x !== y))} />
                    Year {y}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label>Message from</Label>
            <Select value={messageFrom} onValueChange={setMessageFrom}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{messageFromOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        {recipientKind === "STUDENTS" && (
          <p className="text-xs text-muted-foreground -mt-2">
            Students have no login - this will be emailed directly to each matched student&apos;s email on file. A student with no email recorded won&apos;t receive it.
          </p>
        )}

        <div>
          <Label>Departments (empty = all)</Label>
          <div className="mt-1 flex flex-wrap gap-2">
            {departments.map((d) => (
              <label key={d.id} className="flex items-center gap-1.5 rounded border px-2 py-1 text-sm">
                <input type="checkbox" checked={deptIds.includes(d.id)} onChange={(e) => setDeptIds((prev) => e.target.checked ? [...prev, d.id] : prev.filter((x) => x !== d.id))} />
                {d.name}
              </label>
            ))}
            {departments.length === 0 && <span className="text-xs text-muted-foreground">No departments found — will target all.</span>}
          </div>
        </div>

        <div><Label>Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Holiday on 26th Jan" /></div>
        <div><Label>Body</Label><Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="Circular body..." /></div>

        <div>
          <Label>Attachment (optional)</Label>
          <FileUpload onFileSelect={setAttachmentFile} accept=".pdf,.doc,.docx,.png,.jpg" />
          {attachmentFile && <p className="mt-1 text-xs text-muted-foreground">Selected: {attachmentFile.name}</p>}
          {attachment && !attachmentFile && <p className="mt-1 text-xs text-muted-foreground">Attached: {attachment.fileName} — <a href={attachment.fileUrl} target="_blank" className="underline">preview</a></p>}
        </div>

        <div className="flex gap-2">
          <Button onClick={() => void handleSave(false)} disabled={saving} variant="outline">{saving ? "Saving…" : "Save Draft"}</Button>
          <Button onClick={() => void handleSave(true)} disabled={saving}>{saving ? "Publishing…" : "Save & Publish"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
