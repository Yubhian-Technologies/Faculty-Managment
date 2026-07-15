"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { Section, StudentRecord } from "@/types";

export default function StudentsPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [form, setForm] = useState({ sectionId: "", rollNumber: "", name: "" });
  const [saving, setSaving] = useState(false);

  function load() {
    setIsLoading(true);
    Promise.all([
      fetch("/api/college/sections").then((r) => r.json() as Promise<{ sections: Section[] }>).then((d) => setSections(d.sections ?? [])),
      fetch("/api/college/students").then((r) => r.json() as Promise<{ students: StudentRecord[] }>).then((d) => setStudents(d.students ?? [])),
    ])
      .catch(() => toast({ variant: "destructive", title: "Failed to load students" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  const selectedSection = sections.find((s) => s.id === form.sectionId);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSection || !form.rollNumber.trim() || !form.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/college/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rollNumber: form.rollNumber,
          name: form.name,
          section: selectedSection.name,
          year: selectedSection.year,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to add student", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Student added" });
      setForm((f) => ({ ...f, rollNumber: "", name: "" }));
      load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description="Roster for your assigned sections"
        actions={
          <Button variant="outline" asChild>
            <Link href="/panel/students/import"><Upload className="h-4 w-4 mr-1.5" />Bulk Import</Link>
          </Button>
        }
      />

      {!isLoading && sections.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            You are not currently in charge of any section. Ask your HOD to assign you as the faculty-in-charge for a section.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Add Student</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleAdd} className="grid gap-3 sm:grid-cols-4 sm:items-end">
                <div className="space-y-2 sm:col-span-1">
                  <Label>Section</Label>
                  <Select value={form.sectionId} onValueChange={(v) => setForm((f) => ({ ...f, sectionId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} (Year {s.year})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Roll Number</Label>
                  <Input value={form.rollNumber} onChange={(e) => setForm((f) => ({ ...f, rollNumber: e.target.value }))} placeholder="21A91A0501" />
                </div>
                <div className="space-y-2">
                  <Label>Student Name</Label>
                  <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Full name" />
                </div>
                <Button type="submit" loading={saving} disabled={!form.sectionId || !form.rollNumber.trim() || !form.name.trim()}>
                  <Plus className="h-4 w-4 mr-1.5" /> Add
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Roster ({students.length})</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}</div>
              ) : students.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No students added yet.</p>
              ) : (
                <div className="divide-y">
                  {students.map((s) => (
                    <div key={s.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <p className="text-sm font-medium">{s.name}</p>
                        <p className="text-xs text-muted-foreground">{s.rollNumber} · Section {s.section} · Year {s.year}</p>
                      </div>
                      <Badge variant={s.status === "REGULAR" ? "default" : "destructive"} className="text-xs">
                        {s.status === "REGULAR" ? "Regular" : "Detained"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
