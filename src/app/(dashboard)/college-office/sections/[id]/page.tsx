"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Users, Pencil, ArrowRightLeft, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { sectionDisplayLabel } from "@/lib/sections/sectionLabel";
import type { Department, Section, StudentRecord } from "@/types";

type SectionRow = Section & { id: string };

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function OfficeSectionRosterPage() {
  const { id } = useParams<{ id: string }>();
  const [section, setSection] = useState<SectionRow | null>(null);
  const [allSections, setAllSections] = useState<SectionRow[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [moveTarget, setMoveTarget] = useState<StudentRecord | null>(null);
  const [moveSectionId, setMoveSectionId] = useState("");
  const [moveLoading, setMoveLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StudentRecord | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments(d.departments ?? []))
      .catch(() => {});
  }, []);

  function loadRoster() {
    setIsLoading(true);
    return fetch("/api/college/sections")
      .then((r) => r.json() as Promise<{ sections: SectionRow[] }>)
      .then((d) => {
        const sections = d.sections ?? [];
        setAllSections(sections);
        const sec = sections.find((s) => s.id === id) ?? null;
        setSection(sec);
        if (!sec) {
          toast({ variant: "destructive", title: "Section not found" });
          return null;
        }
        // Students API scopes by section NAME + year, not id - section names
        // aren't unique across departments (or even within one, when two
        // sections are cross-listed to different branches - e.g. two "A"s
        // under Basic Science, one feeding CSE and one ECE), so narrow
        // client-side by department and, when this section is cross-listed,
        // by that cross-listing too.
        const secondary = sec.secondaryDepartments?.length === 1 ? sec.secondaryDepartments[0].toLowerCase() : null;
        return fetch(`/api/college/students?section=${encodeURIComponent(sec.name)}&year=${sec.year}`)
          .then((r) => r.json() as Promise<{ students: StudentRecord[] }>)
          .then((sd) => setStudents((sd.students ?? []).filter((s) =>
            s.department === sec.department &&
            (secondary === null || (s.secondaryDepartment ?? "").toLowerCase() === secondary)
          )));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load section" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    void loadRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleMove() {
    if (!moveTarget || !moveSectionId) return;
    setMoveLoading(true);
    try {
      const res = await fetch(`/api/college/students/${moveTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetSectionId: moveSectionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to move student");
      toast({ title: `${moveTarget.name} moved` });
      setMoveTarget(null);
      setMoveSectionId("");
      loadRoster();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to move student" });
    } finally {
      setMoveLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/college/students/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete student");
      toast({ title: `${deleteTarget.name} removed` });
      setDeleteTarget(null);
      loadRoster();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to delete student" });
    } finally {
      setDeleteLoading(false);
    }
  }

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
          actions={<Button variant="outline" asChild><Link href="/college-office/sections"><ArrowLeft className="h-4 w-4 mr-1" />Back to Sections</Link></Button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={sectionDisplayLabel(section, departments)}
        description={`${section.department || "(no department)"}${section.secondaryDepartments && section.secondaryDepartments.length > 0 ? ` → ${section.secondaryDepartments.join(", ")}` : ""} · ${section.courseName ?? ""} · ${ordinalYear(section.year)} · ${section.batch}`}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/college-office/sections"><ArrowLeft className="h-4 w-4 mr-1" />Back to Sections</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/college-office/sections/${id}/edit`}><Pencil className="h-4 w-4 mr-1" />Edit</Link>
            </Button>
            {/* Import Students - temporarily hidden, not removed. Re-enable by
                uncommenting this button. */}
            {/* <Button asChild>
              <Link href="/college-office/students/import"><Upload className="h-4 w-4 mr-1" />Import Students</Link>
            </Button> */}
          </div>
        }
      />

      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Users className="h-4 w-4" />
        <span><strong className="text-foreground">{students.length}</strong> student{students.length !== 1 ? "s" : ""} enrolled</span>
      </div>

      <Card>
        <CardContent className="p-0">
          {students.length === 0 ? (
            <div className="py-16">
              <EmptyState
                title="No students in this section yet"
                description="Students will show up here once added."
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
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Registered Branch</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Gender</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Guardian Contact</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Email</th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {students.map((s) => (
                    <tr key={s.id}>
                      <td className="px-4 py-2.5 font-mono">{s.rollNumber}</td>
                      <td className="px-4 py-2.5 font-medium">{s.name}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant={s.status === "REGULAR" ? "default" : "secondary"} className="text-xs">
                          {s.status === "REGULAR" ? "Regular" : s.status === "DETAINED" ? "Detained" : "Graduated"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        {s.secondaryDepartment
                          ? <Badge variant="outline" className="text-xs">{s.secondaryDepartment}</Badge>
                          : <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{s.gender || "-"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{s.guardianContact || "-"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{s.email || "-"}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setMoveTarget(s); setMoveSectionId(""); }}
                          >
                            <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />Move
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(s)}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1" />Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!moveTarget} onOpenChange={(open) => { if (!open) { setMoveTarget(null); setMoveSectionId(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move {moveTarget?.name}</DialogTitle>
          </DialogHeader>
          <Select value={moveSectionId} onValueChange={setMoveSectionId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a section" />
            </SelectTrigger>
            <SelectContent>
              {allSections.filter((s) => s.id !== id).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {sectionDisplayLabel(s, departments)} · {ordinalYear(s.year)} · {s.batch}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { setMoveTarget(null); setMoveSectionId(""); }} disabled={moveLoading}>
              Cancel
            </Button>
            <Button onClick={handleMove} disabled={!moveSectionId} loading={moveLoading}>
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={`Delete ${deleteTarget?.name}?`}
        description="This permanently removes the student and their department history. This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteLoading}
      />
    </div>
  );
}
