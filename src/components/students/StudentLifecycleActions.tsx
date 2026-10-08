"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import { isJuniorBatch } from "@/lib/students/lifecycle";
import type { StudentRecord } from "@/types";

interface SectionOption {
  id: string;
  name: string;
  year: number;
  department: string;
  courseId?: string;
  courseName?: string;
  batch?: string;
}

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none";

// Detain (flag only), Place (later: repeat the same year in a junior-batch section), Discontinue (leave the college) and Reinstate, on the student's
// profile. The server (students/[id]/lifecycle) re-checks who may do what; this only hides
// what the viewer can't use.
export function StudentLifecycleActions({
  student,
  canReinstate,
  onChanged,
}: {
  student: StudentRecord;
  canReinstate: boolean;
  onChanged: () => void;
}) {
  const [dialog, setDialog] = useState<"DETAIN" | "PLACE" | "DISCONTINUE" | "REINSTATE" | null>(null);
  const [reason, setReason] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Sections of the SAME year and programme in a junior batch, only fetched when the Place dialog opens.
  useEffect(() => {
    if (dialog !== "PLACE") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/college/sections");
        const json = (await res.json()) as { sections?: SectionOption[] };
        if (cancelled) return;
        setSections((json.sections ?? []).filter(
          (s) => s.year === student.year
            && !(s.name === student.section && s.department === student.department)
            && isJuniorBatch(student.batch, s.batch)
            && (!student.courseId || !s.courseId || s.courseId === student.courseId || s.courseName === student.course),
        ).sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name)));
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Couldn't load sections" });
      }
    })();
    return () => { cancelled = true; };
  }, [dialog, student.year, student.courseId, student.course, student.section, student.department, student.batch]);

  const isDiscontinued = student.status === "DISCONTINUED";
  const isGraduated = student.status === "GRADUATED";
  if (isGraduated) return null;

  function close() {
    setDialog(null);
    setReason("");
    setSectionId("");
  }

  async function submit() {
    if (!dialog) return;
    if (dialog === "PLACE" && !sectionId) {
      toast({ variant: "destructive", title: "Pick the section the student will repeat in" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`/api/college/students/${student.id}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: dialog, targetSectionId: sectionId || undefined, reason }),
      });
      const json = (await res.json()) as { error?: string; warning?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Couldn't update the student" });
        return;
      }
      toast({
        variant: json.warning ? "destructive" : "success",
        title: dialog === "DETAIN" ? "Student detained" : dialog === "PLACE" ? "Student placed in the new section" : dialog === "DISCONTINUE" ? "Student discontinued" : "Student reinstated",
        description: json.warning,
      });
      close();
      onChanged();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <Card>
        <CardContent className="space-y-3 p-5">
          <h3 className="text-sm font-semibold text-foreground">Student standing</h3>
          {student.status === "DETAINED" ? (
            <p className="text-sm text-muted-foreground">
              Detained - will repeat Year {student.year}. Still in {student.section ? `Section ${student.section}` : "no section"} until you place them
              in a section of the junior batch (do this once the cohort is promoted or the junior batch's sections exist).
              {student.detainedReason ? ` Reason: ${student.detainedReason}` : ""}
            </p>
          ) : student.detainedPlacedAt ? (
            <p className="text-sm text-muted-foreground">
              Repeating Year {student.year}
              {student.detainedFromSection ? ` (earlier Section ${student.detainedFromSection})` : ""}.
            </p>
          ) : null}
          {isDiscontinued ? (
            <p className="text-sm text-muted-foreground">
              Discontinued. The record and history are kept, but the student is in no class, attendance or timetable and their login is off.
              {student.discontinuedReason ? ` Reason: ${student.discontinuedReason}` : ""}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Detain a student who did not complete the year (they stay where they are for now), or mark them discontinued if they have left the college.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {student.status === "REGULAR" && (
              <Button variant="outline" size="sm" onClick={() => setDialog("DETAIN")}>Detain</Button>
            )}
            {student.status === "DETAINED" && (
              <Button variant="outline" size="sm" onClick={() => setDialog("PLACE")}>Place in junior-batch section</Button>
            )}
            {!isDiscontinued && (
              <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDialog("DISCONTINUE")}>Discontinue</Button>
            )}
            {isDiscontinued && canReinstate && (
              <Button variant="outline" size="sm" onClick={() => setDialog("REINSTATE")}>Reinstate</Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialog !== null} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === "DETAIN" ? "Detain student" : dialog === "PLACE" ? "Place in a junior-batch section" : dialog === "DISCONTINUE" ? "Discontinue student" : "Reinstate student"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "DETAIN" && `${student.name} will be marked Detained and will repeat Year ${student.year}. Nothing moves now: they stay in their section until you place them in the junior batch's section later.`}
              {dialog === "PLACE" && `${student.name} will repeat Year ${student.year} in the section you pick (any section of a junior batch) and become an ordinary student of it. Their earlier attendance and marks stay on record.`}
              {dialog === "DISCONTINUE" && `${student.name} will be removed from their section and every future class, attendance and timetable, and their login will be switched off. Their data is kept.`}
              {dialog === "REINSTATE" && `${student.name} will be back on the rolls (not in a section yet) and their login switched on.`}
            </DialogDescription>
          </DialogHeader>
          {dialog === "PLACE" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Repeat in section</label>
              <select className={selectClass} value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                <option value="">{sections.length === 0 ? "No junior-batch section for this year yet" : "Select a section of the junior batch"}</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>{s.department} - Section {s.name}{s.batch ? ` (${s.batch})` : ""}</option>
                ))}
              </select>
            </div>
          )}
          {(dialog === "DETAIN" || dialog === "DISCONTINUE") && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason (optional)</label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Shortage of attendance / backlogs" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={isSaving}>Cancel</Button>
            <Button onClick={() => void submit()} loading={isSaving} variant={dialog === "DISCONTINUE" ? "destructive" : "default"}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
