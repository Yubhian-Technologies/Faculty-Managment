"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import type { Subject, SubjectSemesterAssignment } from "@/types";

// Type-in "Add subject" for the Assign Faculty forms (HOD, sub-HOD, Timetable
// Incharge). Creates a hand-typed subject for the chosen section's department +
// semester via POST /api/college/subjects/custom; such a subject never appears
// on a faculty resume.
export function CustomSubjectAdder({
  courseId,
  sectionId,
  semester,
  onAdded,
}: {
  courseId: string;
  sectionId: string;
  semester: number | null;
  onAdded: (created: { subject: Subject; assignment: SubjectSemesterAssignment }) => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const blocked = !sectionId || semester == null;

  async function add() {
    if (blocked || !name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/college/subjects/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, sectionId, semester, name: name.trim() }),
      });
      const json = (await res.json()) as { error?: string; existing?: boolean; subject?: Subject; assignment?: SubjectSemesterAssignment };
      if (!res.ok || !json.subject || !json.assignment) {
        toast({ variant: "destructive", title: "Failed to add subject", description: json.error });
        return;
      }
      toast({
        variant: "success",
        title: json.existing ? "Subject already exists for this department" : "Subject added for the whole department",
        description: "It's selected above - every section of the department can pick it. Now assign a faculty.",
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
    <div className="flex items-center gap-2">
      <Input
        placeholder={blocked ? "Pick a section first" : "Or type a new subject (e.g. NSS)"}
        value={name}
        disabled={blocked}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
      />
      <Button type="button" variant="outline" loading={saving} disabled={blocked || !name.trim()} onClick={() => void add()}>
        Add subject
      </Button>
    </div>
  );
}
