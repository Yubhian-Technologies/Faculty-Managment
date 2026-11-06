"use client";

import { useEffect, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/useToast";

// HOD: the subjects their department looks after (Subject Department, set by Academics) in every
// branch they are taught - the HOD keeps each one's syllabus here; their question banks / papers
// come to this HOD for approval. Hidden when the department looks after none.

interface Row { id: string; name: string; code: string; courseName: string; regulation: string; department: string; syllabusUrl: string | null; syllabusFileName: string | null; syllabusUpdatedByName: string | null; isActive: boolean }

export function DepartmentSubjectsCard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState("");

  const [reloadKey, setReloadKey] = useState(0);
  const load = () => setReloadKey((k) => k + 1);
  useEffect(() => {
    let off = false;
    fetch("/api/college/subjects/owned")
      .then(async (res) => { const d = (await res.json()) as { subjects?: Row[] }; if (!off) setRows(res.ok ? d.subjects ?? [] : []); })
      .catch(() => { if (!off) setRows([]); });
    return () => { off = true; };
  }, [reloadKey]);

  async function upload(r: Row, file: File) {
    setBusy(r.id);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/college/subjects/${r.id}/syllabus`, { method: "POST", body: form });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: j.error ?? "Upload failed" }); return; }
      toast({ variant: "success", title: `Syllabus saved for ${r.code}` });
      load();
    } finally { setBusy(""); }
  }
  async function remove(r: Row) {
    setBusy(r.id);
    try {
      const res = await fetch(`/api/college/subjects/${r.id}/syllabus`, { method: "DELETE" });
      if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string }; toast({ variant: "destructive", title: j.error ?? "Couldn't remove it" }); return; }
      load();
    } finally { setBusy(""); }
  }

  if (!rows || rows.length === 0) return null;
  const active = rows.filter((r) => r.isActive);
  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-3 p-5">
        <div>
          <h2 className="font-semibold">Subjects your department looks after</h2>
          <p className="text-xs text-muted-foreground">Set by Academics. You keep their syllabus, and their question banks / papers come to you for approval from every branch they are taught in.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1.5 pr-3">Subject</th><th className="py-1.5 pr-3">Course · Regulation</th><th className="py-1.5 pr-3">Department</th><th className="py-1.5">Syllabus</th></tr>
            </thead>
            <tbody className="divide-y">
              {active.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-3"><span className="font-medium">{r.name}</span> <span className="font-mono text-xs text-muted-foreground">{r.code}</span></td>
                  <td className="py-1.5 pr-3 text-xs">{r.courseName}{r.regulation ? ` · ${r.regulation}` : ""}</td>
                  <td className="py-1.5 pr-3 text-xs">{r.department}</td>
                  <td className="py-1.5 whitespace-nowrap">
                    {r.syllabusUrl && (
                      <>
                        <a href={r.syllabusUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline" title={[r.syllabusFileName, r.syllabusUpdatedByName && `by ${r.syllabusUpdatedByName}`].filter(Boolean).join(" ")}><FileText className="h-3.5 w-3.5" />View</a>
                        <Button variant="ghost" size="icon" className="ml-1 h-7 w-7 text-destructive" aria-label={`Remove the syllabus of ${r.code}`} disabled={busy === r.id} onClick={() => void remove(r)}><X className="h-3.5 w-3.5" /></Button>
                      </>
                    )}
                    <label className={`inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground ${busy === r.id ? "pointer-events-none opacity-50" : ""}`}>
                      <Upload className="h-3.5 w-3.5" />{busy === r.id ? "Saving..." : r.syllabusUrl ? "Replace" : "Upload PDF"}
                      <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(r, f); }} />
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
