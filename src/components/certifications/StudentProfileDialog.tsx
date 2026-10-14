"use client";

import { useState } from "react";
import { UserCircle2 } from "lucide-react";
import { Avatar } from "@/components/shared/Avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { DETAIL_ROSTER_FIELDS, ROSTER_DETAIL_GROUPS, rosterFieldDisplay, type RosterField } from "@/lib/students/rosterFields";
import type { StudentRecord } from "@/types";
import { getRequestStudent } from "./api";

// Full, read-only access to the requesting student's roster record - every
// approver stage (HOD, Library, Hostel, PD, Placement, College Office, Exam
// Cell) opens the same dialog from its own queue card. Reuses the grouped
// layout (ROSTER_DETAIL_GROUPS) the College Office/HOD/Principal already see
// on StudentDetailsPage, so the data reads the same way everywhere - just
// scoped here to the one student behind the request actually in front of
// the approver, via /certificate-requests/[id]/student.

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

function Fact({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium break-words">{value}</p>
    </div>
  );
}

const DETAIL_FIELD_BY_KEY = new Map(DETAIL_ROSTER_FIELDS.map((f) => [f.key, f]));

function groupFacts(keys: string[], student: StudentRecord): { key: string; label: string; value: string }[] {
  return keys
    .map((k) => DETAIL_FIELD_BY_KEY.get(k))
    .filter((f): f is RosterField => !!f)
    .map((f) => ({ key: f.key, label: f.label, value: rosterFieldDisplay(f, student) }))
    .filter((f) => f.value !== "");
}

export function StudentProfileDialog({ requestId, studentName }: { requestId: string; studentName: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [student, setStudent] = useState<StudentRecord | null>(null);

  async function handleOpen() {
    setOpen(true);
    if (student) return;
    setLoading(true);
    try {
      setStudent(await getRequestStudent(requestId));
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Couldn't load the student's profile" });
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={handleOpen} className="gap-1.5">
        <UserCircle2 className="h-3.5 w-3.5" />
        View Profile
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{student?.name ?? studentName}</DialogTitle>
          </DialogHeader>

          {loading && <p className="text-sm text-muted-foreground py-6 text-center">Loading student profile…</p>}

          {!loading && student && (
            <div className="space-y-5">
              <div className="flex items-center gap-4">
                <Avatar name={student.name} photoUrl={student.profilePhotoUrl} size="lg" />
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 flex-1 min-w-0">
                  <Fact label="Roll No" value={student.rollNumber} />
                  <Fact label="Course" value={student.course} />
                  <Fact label="Department" value={student.department} />
                  <Fact label="Academic Year" value={student.year ? ordinalYear(student.year) : undefined} />
                  <Fact label="Section" value={student.section} />
                  <Fact label="Batch" value={student.batch} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 max-h-[55vh] overflow-y-auto pr-1">
                {ROSTER_DETAIL_GROUPS.map((group) => {
                  const rows = groupFacts(group.keys, student);
                  if (rows.length === 0) return null;
                  return (
                    <div key={group.title} className="rounded-lg border p-4">
                      <h3 className="text-sm font-semibold mb-3">{group.title}</h3>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                        {rows.map((f) => <Fact key={f.key} label={f.label} value={f.value} />)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
