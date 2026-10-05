"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { StudentRow } from "./types";

interface Props {
  editTarget: StudentRow | null;
  setEditTarget: (s: StudentRow | null) => void;
  editRoll: string;
  setEditRoll: (v: string) => void;
  editStatus: string;
  setEditStatus: (v: string) => void;
  editLabBatch: string;
  setEditLabBatch: (v: string) => void;
  editLabBatchSuggestions: string[];
  isSavingEdit: boolean;
  handleSaveEdit: () => Promise<void> | void;
}

// The HOD Students page's "edit a student" dialog (roll number, status, lab batch).
export function EditStudentDialog({
  editTarget, setEditTarget, editRoll, setEditRoll, editStatus, setEditStatus,
  editLabBatch, setEditLabBatch, editLabBatchSuggestions, isSavingEdit, handleSaveEdit,
}: Props) {
  return (
    <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editTarget?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {editTarget?.department} · Year {editTarget?.year} · {editTarget?.section ? `Section ${editTarget.section}` : "Unassigned"}
          </p>
          <div className="space-y-2">
            <Label htmlFor="edit-roll">Roll Number</Label>
            <Input
              id="edit-roll"
              value={editRoll}
              onChange={(e) => setEditRoll(e.target.value)}
              placeholder="e.g. 21A91A0501"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">The student&apos;s unique roll number - it can be corrected, but must not be used by any other student.</p>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={editStatus} onValueChange={setEditStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="REGULAR">Regular</SelectItem>
                <SelectItem value="DETAINED">Detained</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-lab-batch">Lab Batch</Label>
            <Input
              id="edit-lab-batch"
              list="edit-lab-batch-suggestions"
              value={editLabBatch}
              onChange={(e) => setEditLabBatch(e.target.value)}
              placeholder="e.g. Batch 1"
              autoComplete="off"
            />
            <datalist id="edit-lab-batch-suggestions">
              {editLabBatchSuggestions.map((label) => <option key={label} value={label} />)}
            </datalist>
            <p className="text-xs text-muted-foreground">
              Which split-lab sub-group this student sits in for a PRACTICAL subject - must match the batch
              label on the Timetable exactly. Leave blank if this section&rsquo;s labs aren&rsquo;t split.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
          <Button onClick={() => void handleSaveEdit()} loading={isSavingEdit}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
