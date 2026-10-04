"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { StudentRow, SectionRow } from "./types";

interface Props {
  assignTarget: StudentRow | null;
  setAssignTarget: (s: StudentRow | null) => void;
  assignSectionId: string;
  setAssignSectionId: (v: string) => void;
  assignTargetSections: SectionRow[];
  assignSectionLabels: Map<string, string>;
  isAssigning: boolean;
  isUnassigning: boolean;
  handleAssign: () => Promise<void> | void;
  handleUnassign: () => Promise<void> | void;
}

// The HOD Students page's "assign / move / unassign a student" dialog.
export function AssignStudentDialog({
  assignTarget, setAssignTarget, assignSectionId, setAssignSectionId, assignTargetSections,
  assignSectionLabels, isAssigning, isUnassigning, handleAssign, handleUnassign,
}: Props) {
  return (
    <Dialog open={!!assignTarget} onOpenChange={(open) => { if (!open) setAssignTarget(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{assignTarget?.section ? "Move" : "Assign"} {assignTarget?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {assignTarget?.secondaryDepartment
              ? <>Pre-registered to <strong>{assignTarget.secondaryDepartment}</strong> · Year {assignTarget?.year}</>
              : <>{assignTarget?.department} · Year {assignTarget?.year}</>}
            {assignTarget?.section ? ` · currently Section ${assignTarget.section}` : " · currently Unassigned"}
          </p>
          <div className="space-y-2">
            <Label>Section</Label>
            <Select value={assignSectionId} onValueChange={setAssignSectionId}>
              <SelectTrigger><SelectValue placeholder="Select section" /></SelectTrigger>
              <SelectContent>
                {assignTargetSections.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{assignSectionLabels.get(s.id) ?? s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {assignTargetSections.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No sections yet for {assignTarget?.secondaryDepartment || assignTarget?.department} Year {assignTarget?.year} - create one under Sections first.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          {assignTarget?.section && (
            <Button
              type="button"
              variant="outline"
              className="mr-auto text-destructive hover:text-destructive"
              onClick={() => void handleUnassign()}
              loading={isUnassigning}
            >
              Unassign
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setAssignTarget(null)}>Cancel</Button>
          <Button onClick={() => void handleAssign()} loading={isAssigning} disabled={!assignSectionId}>
            {assignTarget?.section ? "Move" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
