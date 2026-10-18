"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClassRepresentativesCard } from "@/components/sections/ClassRepresentativesCard";
import { toast } from "@/hooks/useToast";
import type { Section, StudentRecord } from "@/types";

// Section Settings of the class incharge: picks the section's Class Representatives from its students. How many there are is the
// HOD's call (HOD Settings > Class Representatives) - shown here, not editable.
export default function ClassRepresentativesPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  async function loadStudents(sec: Section | undefined) {
    if (!sec) { setStudents([]); return; }
    try {
      const qs = new URLSearchParams({ section: sec.name, year: String(sec.year) });
      const res = await fetch(`/api/college/students?${qs}`);
      const json = await res.json() as { students?: StudentRecord[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setStudents((json.students ?? []).filter((s) =>
        (s.department === sec.department || s.secondaryDepartment === sec.department) && s.section === sec.name && s.year === sec.year,
      ));
    } catch {
      toast({ variant: "destructive", title: "Failed to load students" });
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/sections");
        const json = await res.json() as { sections?: Section[] };
        const list = json.sections ?? [];
        setSections(list);
        setSectionId(list[0]?.id ?? "");
        await loadStudents(list[0]);
      } catch {
        toast({ variant: "destructive", title: "Failed to load sections" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const selected = sections.find((s) => s.id === sectionId);

  return (
    <div className="space-y-6">
      <PageHeader title="Section Settings" description="Pick your section's Class Representatives from its students" />
      {!isLoading && sections.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            You are not currently in charge of any section. Ask your HOD to assign you as the faculty-in-charge for a section.
          </CardContent>
        </Card>
      ) : (
        <>
          {sections.length > 1 && (
            <div className="space-y-1.5 max-w-xs">
              <Label>Section</Label>
              <Select value={sectionId} onValueChange={(id) => { setSectionId(id); void loadStudents(sections.find((s) => s.id === id)); }}>
                <SelectTrigger><SelectValue placeholder="Select a section" /></SelectTrigger>
                <SelectContent>
                  {sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} (Year {s.year})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {selected && (
            <ClassRepresentativesCard
              section={selected}
              students={students}
              canSetCount={false}
              onSaved={(patch) => setSections((prev) => prev.map((x) => (x.id === selected.id ? { ...x, ...patch } : x)))}
            />
          )}
        </>
      )}
    </div>
  );
}
