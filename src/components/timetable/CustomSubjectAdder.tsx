"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import type { Subject, SubjectSemesterAssignment } from "@/types";

// Type-in "Add subject" for a DEPARTMENT (HOD, sub-HOD, Timetable Incharge),
// shown on its own - outside the Assign Faculty form - because the subject
// belongs to the department's semester, not to any one section. It is created
// via POST /api/college/subjects/custom, after which every section of that
// department picks it from the normal Subject list, exactly like a regular
// subject. Such a subject never appears on a faculty resume.
export function CustomSubjectAdder({
  courseIdFor,
  year,
  semester,
  departments,
  onAdded,
}: {
  /** The course doc to file the subject under for a given department. */
  courseIdFor: (departmentId: string) => string;
  year: number;
  semester: number | null;
  departments: { id: string; name: string }[];
  onAdded: (created: { subject: Subject; assignment: SubjectSemesterAssignment }) => void;
}) {
  const [departmentId, setDepartmentId] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  // One department to pick from needs no picking.
  const effectiveDepartmentId = departmentId || (departments.length === 1 ? departments[0].id : "");
  const blocked = semester == null || departments.length === 0;

  async function add() {
    if (blocked || !effectiveDepartmentId || !name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/college/subjects/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: courseIdFor(effectiveDepartmentId),
          departmentId: effectiveDepartmentId,
          year,
          semester,
          name: name.trim(),
        }),
      });
      const json = (await res.json()) as { error?: string; existing?: boolean; subject?: Subject; assignment?: SubjectSemesterAssignment };
      if (!res.ok || !json.subject || !json.assignment) {
        toast({ variant: "destructive", title: "Failed to add subject", description: json.error });
        return;
      }
      toast({
        variant: "success",
        title: json.existing ? "Subject already exists for this department" : "Subject added for the whole department",
        description: "Pick it in the Subject list of any section of that department.",
      });
      setName("");
      onAdded({ subject: json.subject, assignment: json.assignment });
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border bg-card p-4">
      <div>
        <p className="text-sm font-semibold">Add a subject for a department</p>
        <p className="text-xs text-muted-foreground">
          e.g. NSS, Sports. It is added for the department&apos;s semester, so every one of its sections can pick it
          from the Subject list like any regular subject.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="cus-dept" className="text-xs">Department</Label>
          <select
            id="cus-dept"
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={effectiveDepartmentId}
            disabled={blocked}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            {departments.length !== 1 && <option value="">Select department</option>}
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cus-name" className="text-xs">Subject name</Label>
          <Input
            id="cus-name"
            placeholder={semester == null ? "Pick a semester first" : "Type a new subject (e.g. NSS)"}
            value={name}
            disabled={blocked}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
          />
        </div>
        <Button type="button" variant="outline" loading={saving} disabled={blocked || !effectiveDepartmentId || !name.trim()} onClick={() => void add()}>
          Add subject
        </Button>
      </div>
    </div>
  );
}
