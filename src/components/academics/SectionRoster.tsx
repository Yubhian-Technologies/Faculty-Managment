"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Search, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SectionTimetable } from "@/components/academics/SectionTimetable";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { RosterDetailView } from "@/components/students/RosterFieldInputs";
import { toast } from "@/hooks/useToast";
import type { Section, StudentRecord } from "@/types";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

// One section's roster (rendered in place inside the Courses page toggles), for Principal / Vice Principal / College Admin.
// View-only throughout: the student write routes are HOD / College Office, so
// this offers no edit, no add and no remove - clicking a row opens the same
// full profile the HOD sees, and nothing more.
export function SectionRoster({ sectionId: id, onBack, backLabel = "Back to Sections" }: {
  sectionId: string;
  onBack: () => void;
  backLabel?: string;
}) {
  const [section, setSection] = useState<Section | null>(null);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewTarget, setViewTarget] = useState<StudentRecord | null>(null);
  const [tab, setTab] = useState<"students" | "timetable">("students");
  const [query, setQuery] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const secData = await fetch("/api/college/sections")
          .then((r) => r.json() as Promise<{ sections?: Section[] }>);
        const sec = (secData.sections ?? []).find((s) => s.id === id) ?? null;
        setSection(sec);
        if (!sec) {
          toast({ variant: "destructive", title: "Section not found" });
          return;
        }
        // The students API scopes by section NAME + year, not id - section
        // names repeat across departments - so the result is narrowed here.
        // A shared-first-year student stays filed under their common
        // department until promotion, with secondaryDepartment naming the
        // real branch, so the section they actually sit in can match either
        // field. Same rule the HOD's own section page applies.
        const stuData = await fetch(
          `/api/college/students?section=${encodeURIComponent(sec.name)}&year=${sec.year}`
        ).then((r) => r.json() as Promise<{ students?: StudentRecord[] }>);
        setStudents(
          (stuData.students ?? []).filter(
            (s) => s.department === sec.department || s.secondaryDepartment === sec.department
          )
        );
      } catch {
        toast({ variant: "destructive", title: "Failed to load section" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [id]);

  const backButton = (
    <Button variant="outline" onClick={onBack}>
      <ArrowLeft className="h-4 w-4 mr-1" />{backLabel}
    </Button>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Section" description="Loading…" actions={backButton} />
        <CardSkeleton />
      </div>
    );
  }

  if (!section) {
    return (
      <div className="space-y-6">
        <PageHeader title="Section not found" description="It may have been removed." actions={backButton} />
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? students.filter((s) =>
        [s.rollNumber, s.name, s.email].some((v) => (v ?? "").toLowerCase().includes(q)))
    : students;
  const showBranchColumn = students.some((s) => s.secondaryDepartment);

  return (
    <div className="space-y-6">
      <PageHeader
        title={section.name}
        description={`${section.department}${section.courseName ? ` · ${section.courseName}` : ""} · ${ordinalYear(section.year)}`}
        actions={backButton}
      />

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        {section.batch && <Badge variant="outline" className="text-xs">{section.batch}</Badge>}
        {section.regulation && <Badge variant="outline" className="text-xs">{section.regulation}</Badge>}
        <span className="flex items-center gap-1.5">
          <Users className="h-4 w-4" />
          <strong className="text-foreground">{students.length}</strong> student{students.length !== 1 ? "s" : ""} enrolled
        </span>
        <span>
          Incharge:{" "}
          {section.facultyInchargeName
            ? <strong className="text-foreground">{section.facultyInchargeName}</strong>
            : <span className="italic">Not assigned</span>}
        </span>
      </div>

      <div role="tablist" className="inline-flex gap-1 rounded-lg bg-muted p-1">
        {([["students", "Students"], ["timetable", "Timetable"]] as const).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "timetable" && <SectionTimetable section={section} />}

      {tab === "students" && (
      <>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by roll no., name or email"
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {students.length === 0 ? "No students in this section yet." : "No students match your search."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Roll No.</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Name</th>
                    {showBranchColumn && (
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Registered Branch</th>
                    )}
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Gender</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Email</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setViewTarget(s)}
                      className="cursor-pointer hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-4 py-2.5 font-mono">{s.rollNumber}</td>
                      <td className="px-4 py-2.5 font-medium">{s.name}</td>
                      {showBranchColumn && (
                        <td className="px-4 py-2.5">
                          {s.secondaryDepartment
                            ? <Badge variant="outline" className="text-xs">{s.secondaryDepartment}</Badge>
                            : <span className="text-muted-foreground">-</span>}
                        </td>
                      )}
                      <td className="px-4 py-2.5">
                        <Badge variant={s.status === "REGULAR" ? "default" : "secondary"} className="text-xs">
                          {s.status === "REGULAR" ? "Regular" : s.status === "DETAINED" ? "Detained" : "Graduated"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{s.gender || "-"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{s.email || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      </>
      )}

      {/* Full profile - the same read-only view the HOD and College Office see. */}
      <Dialog open={!!viewTarget} onOpenChange={(open) => { if (!open) setViewTarget(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewTarget?.name}</DialogTitle>
          </DialogHeader>

          {viewTarget && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Section:</span>
              <Badge variant="secondary" className="text-xs">{section.name}</Badge>
              <span className="text-muted-foreground ml-3">Status:</span>
              <Badge variant="secondary" className="text-xs">{viewTarget.status}</Badge>
            </div>
          )}

          {viewTarget && <RosterDetailView student={viewTarget} />}

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewTarget(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
