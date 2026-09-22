"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Layers } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { Section, StudentRecord } from "@/types";

const ALL_SECTIONS = "ALL";
const ALL_BATCHES = "ALL";

export default function StudentsPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sectionFilter, setSectionFilter] = useState(ALL_SECTIONS);
  // Batches are scoped per section (see panel/students/batches/page.tsx), so
  // this only ever applies once a specific section is picked above - reset
  // whenever that changes, same as picking "All Sections" clears it too.
  const [batchFilter, setBatchFilter] = useState(ALL_BATCHES);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      fetch("/api/college/sections").then((r) => r.json() as Promise<{ sections: Section[] }>).then((d) => setSections(d.sections ?? [])),
      fetch("/api/college/students").then((r) => r.json() as Promise<{ students: StudentRecord[] }>).then((d) => setStudents(d.students ?? [])),
    ])
      .catch(() => toast({ variant: "destructive", title: "Failed to load students" }))
      .finally(() => setIsLoading(false));
  }, []);

  // The API already scopes `students` to exactly the faculty's in-charge
  // sections (department + section + year) - this is a defense-in-depth
  // re-check, not the primary authorization boundary. A shared-first-year
  // student in one of these sections stays filed under their common
  // department until promotion, with secondaryDepartment naming the
  // section's real branch instead (see students/[id] PATCH) - check both.
  const inChargeKeys = new Set(sections.map((s) => `${s.department}::${s.name}::${s.year}`));
  const authorizedStudents = students.filter((s) =>
    inChargeKeys.has(`${s.department}::${s.section}::${s.year}`)
    || inChargeKeys.has(`${s.secondaryDepartment ?? ""}::${s.section}::${s.year}`)
  );

  const selectedSection = sections.find((s) => s.id === sectionFilter);
  const sectionStudents = selectedSection
    ? authorizedStudents.filter(
        (s) => (s.department === selectedSection.department || s.secondaryDepartment === selectedSection.department)
          && s.section === selectedSection.name && s.year === selectedSection.year
      )
    : authorizedStudents;

  // Every lab-batch label actually in use within the selected section (see
  // StudentRecord.labBatch's own doc-comment) - only offered once a specific
  // section is picked, since a batch label only means something within one
  // section's own split lab periods (the same label in a different section
  // is an unrelated coincidence, not the same batch).
  const batchOptions = selectedSection
    ? Array.from(new Set(sectionStudents.map((s) => s.labBatch?.trim()).filter((v): v is string => !!v))).sort()
    : [];
  const visibleStudents = batchFilter === ALL_BATCHES
    ? sectionStudents
    : sectionStudents.filter((s) => (s.labBatch ?? "").trim() === batchFilter);

  function handleSectionFilterChange(value: string) {
    setSectionFilter(value);
    setBatchFilter(ALL_BATCHES);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description="Roster for your assigned sections"
      />

      {!isLoading && sections.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            You are not currently in charge of any section. Ask your HOD to assign you as the faculty-in-charge for a section.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3 space-y-3">
            <CardTitle className="text-base">Roster ({visibleStudents.length})</CardTitle>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-2 sm:max-w-xs">
                <Label>Section</Label>
                <Select value={sectionFilter} onValueChange={handleSectionFilterChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_SECTIONS}>All Sections</SelectItem>
                    {sections.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name} (Year {s.year})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Batch only means something within one section's own split lab
                  periods - only offered once a specific section is picked
                  above, never across "All Sections". */}
              {selectedSection && batchOptions.length > 0 && (
                <div className="space-y-2 sm:max-w-xs">
                  <Label>Batch</Label>
                  <Select value={batchFilter} onValueChange={setBatchFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_BATCHES}>All Batches</SelectItem>
                      {batchOptions.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {selectedSection && batchOptions.length === 0 && (
                <Link href="/panel/students/batches" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 pb-2">
                  <Layers className="h-3.5 w-3.5" />No lab batches set up for this section yet - add some
                </Link>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}</div>
            ) : visibleStudents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {batchFilter !== ALL_BATCHES
                  ? `No students in ${batchFilter}.`
                  : selectedSection ? "No students in this section yet." : "No students in your assigned sections yet."}
              </p>
            ) : (
              <div className="divide-y">
                {visibleStudents.map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.rollNumber} · Section {s.section} · Year {s.year}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {s.labBatch && <Badge variant="outline" className="text-[10px]">{s.labBatch}</Badge>}
                      <Badge variant={s.status === "REGULAR" ? "default" : s.status === "GRADUATED" ? "secondary" : "destructive"} className="text-xs">
                        {s.status === "REGULAR" ? "Regular" : s.status === "GRADUATED" ? "Graduated" : "Detained"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
