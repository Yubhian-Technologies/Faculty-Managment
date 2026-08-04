"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Upload, Users, UserCog } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import type { SectionListItem, StudentRecord, TeachingAssignment } from "@/types";

type SectionRow = SectionListItem;
type AssignmentRow = TeachingAssignment & { id: string };

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function SectionRosterPage() {
  const { id } = useParams<{ id: string }>();
  const [section, setSection] = useState<SectionRow | null>(null);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetch("/api/college/sections")
      .then((r) => r.json() as Promise<{ sections: SectionRow[] }>)
      .then((d) => {
        const sec = (d.sections ?? []).find((s) => s.id === id) ?? null;
        setSection(sec);
        if (!sec) {
          toast({ variant: "destructive", title: "Section not found" });
          return null;
        }
        return Promise.all([
          // Students API scopes by section NAME + year, not id — section names
          // aren't unique across departments, so narrow client-side (same
          // caveat as the Principal promotions roster fetch).
          fetch(`/api/college/students?section=${encodeURIComponent(sec.name)}&year=${sec.year}`)
            .then((r) => r.json() as Promise<{ students: StudentRecord[] }>)
            .then((sd) => setStudents((sd.students ?? []).filter((s) => s.department === sec.department))),
          fetch(`/api/college/teaching-assignments?sectionId=${id}`)
            .then((r) => r.json() as Promise<{ assignments: AssignmentRow[] }>)
            .then((ad) => setAssignments(ad.assignments ?? [])),
        ]);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load section" }))
      .finally(() => setIsLoading(false));
  }, [id]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Loading..." description="" />
        <div className="space-y-2">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
      </div>
    );
  }

  if (!section) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Section not found"
          description=""
          actions={<Button variant="outline" asChild><Link href="/hod/sections"><ArrowLeft className="h-4 w-4 mr-1" />Back to Sections</Link></Button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Section ${section.name}`}
        description={`${section.courseName ?? ""}${section.secondaryDepartments && section.secondaryDepartments.length > 0 ? ` → ${section.secondaryDepartments.join(", ")}` : ""} · ${ordinalYear(section.year)} · ${section.batch}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/hod/sections"><ArrowLeft className="h-4 w-4 mr-1" />Back to Sections</Link>
            </Button>
            {section.accessLevel !== "secondary" && (
              <Button asChild>
                <Link href="/hod/students/import"><Upload className="h-4 w-4 mr-1" />Import Students</Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Users className="h-4 w-4" />
          <span><strong className="text-foreground">{students.length}</strong> student{students.length !== 1 ? "s" : ""} enrolled</span>
        </div>
        {section.accessLevel === "secondary" && (
          <Badge variant="secondary" className="text-xs">View only</Badge>
        )}
      </div>

      {assignments.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5"><UserCog className="h-4 w-4" />Assigned Faculty</p>
          <div className="flex flex-wrap gap-2">
            {assignments.map((a) => (
              <Badge key={a.id} variant="outline" className="text-xs font-normal">
                {a.subjectName} — {a.facultyName || "Unassigned"}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {students.length === 0 ? (
            <div className="py-16">
              <EmptyState
                title="No students in this section yet"
                description="Import a roster to get started."
                icon={<Users className="h-8 w-8" />}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Roll No.</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Name</th>
                    {students.some((s) => s.secondaryDepartment) && (
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Registered Branch</th>
                    )}
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Gender</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Guardian Contact</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Email</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {students.map((s) => (
                    <tr key={s.id}>
                      <td className="px-4 py-2.5 font-mono">{s.rollNumber}</td>
                      <td className="px-4 py-2.5 font-medium">{s.name}</td>
                      {students.some((st) => st.secondaryDepartment) && (
                        <td className="px-4 py-2.5">
                          {s.secondaryDepartment
                            ? <Badge variant="outline" className="text-xs">{s.secondaryDepartment}</Badge>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                      )}
                      <td className="px-4 py-2.5">
                        <Badge variant={s.status === "REGULAR" ? "default" : "secondary"} className="text-xs">
                          {s.status === "REGULAR" ? "Regular" : s.status === "DETAINED" ? "Detained" : "Graduated"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{s.gender || "—"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{s.guardianContact || "—"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{s.email || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
