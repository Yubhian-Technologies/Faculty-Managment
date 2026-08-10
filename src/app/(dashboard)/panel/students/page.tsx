"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { Section, StudentRecord } from "@/types";

const ALL_SECTIONS = "ALL";

export default function StudentsPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sectionFilter, setSectionFilter] = useState(ALL_SECTIONS);

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
  // re-check, not the primary authorization boundary.
  const inChargeKeys = new Set(sections.map((s) => `${s.department}::${s.name}::${s.year}`));
  const authorizedStudents = students.filter((s) => inChargeKeys.has(`${s.department}::${s.section}::${s.year}`));

  const selectedSection = sections.find((s) => s.id === sectionFilter);
  const visibleStudents = selectedSection
    ? authorizedStudents.filter(
        (s) => s.department === selectedSection.department && s.section === selectedSection.name && s.year === selectedSection.year
      )
    : authorizedStudents;

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
            <div className="space-y-2 sm:max-w-xs">
              <Label>Section</Label>
              <Select value={sectionFilter} onValueChange={setSectionFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_SECTIONS}>All Sections</SelectItem>
                  {sections.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name} (Year {s.year})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}</div>
            ) : visibleStudents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {selectedSection ? "No students in this section yet." : "No students in your assigned sections yet."}
              </p>
            ) : (
              <div className="divide-y">
                {visibleStudents.map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.rollNumber} · Section {s.section} · Year {s.year}</p>
                    </div>
                    <Badge variant={s.status === "REGULAR" ? "default" : s.status === "GRADUATED" ? "secondary" : "destructive"} className="text-xs">
                      {s.status === "REGULAR" ? "Regular" : s.status === "GRADUATED" ? "Graduated" : "Detained"}
                    </Badge>
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
