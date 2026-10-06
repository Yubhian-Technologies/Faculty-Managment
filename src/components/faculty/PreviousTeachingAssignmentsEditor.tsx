"use client";

import { Plus, Trash2, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { emptyPreviousTeaching, PREVIOUS_TEACHING_SOURCE_LABELS } from "@/lib/faculty/previousTeaching";
import type { PreviousTeachingAssignment, PreviousTeachingSource } from "@/types";

function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `prev_${Date.now()}_${Math.random()}`;
}

/** A new, empty record - exported so a host editor can add one from its own button. */
export function newPreviousTeachingRecord(): PreviousTeachingAssignment {
  return emptyPreviousTeaching(newId());
}

interface ListProps {
  value: PreviousTeachingAssignment[];
  onChange: (rows: PreviousTeachingAssignment[]) => void;
}

// The rows only - no heading or Add button - so TeachingAssignmentsEditor can show them under its own "Previous"
// heading. Every field is free text; College Name appears only when the row is External.
export function PreviousTeachingRecordList({ value, onChange }: ListProps) {
  function update(id: string, patch: Partial<PreviousTeachingAssignment>) {
    onChange(value.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-3">
      {value.map((row) => (
        <div key={row.id} className="space-y-3 rounded-md bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              <History className="h-3 w-3" />Previous Teaching Assignment
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(value.filter((r) => r.id !== row.id))} aria-label="Remove previous teaching assignment">
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Internal / External *</Label>
              <Select
                value={row.source}
                onValueChange={(v) => update(row.id, { source: v as PreviousTeachingSource, ...(v === "INTERNAL" ? { collegeName: "" } : {}) })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PREVIOUS_TEACHING_SOURCE_LABELS) as PreviousTeachingSource[]).map((k) => (
                    <SelectItem key={k} value={k}>{PREVIOUS_TEACHING_SOURCE_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {row.source === "EXTERNAL" && (
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">College Name *</Label>
                <Input value={row.collegeName ?? ""} onChange={(e) => update(row.id, { collegeName: e.target.value })} placeholder="Name of the college where this was taught" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Academic Year</Label>
              <Input value={row.academicYear} onChange={(e) => update(row.id, { academicYear: e.target.value })} placeholder="e.g. 2024-2025" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Course</Label>
              <Input value={row.course} onChange={(e) => update(row.id, { course: e.target.value })} placeholder="e.g. B.Tech" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Year</Label>
              <Input value={row.year} onChange={(e) => update(row.id, { year: e.target.value })} placeholder="e.g. 1st, 2nd" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Semester</Label>
              <Input value={row.semester} onChange={(e) => update(row.id, { semester: e.target.value })} placeholder="e.g. I, II" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Subject</Label>
              <Input value={row.subject} onChange={(e) => update(row.id, { subject: e.target.value })} placeholder="Subject taught" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Passing Percentage %</Label>
              <Input value={row.passPercentage} onChange={(e) => update(row.id, { passPercentage: e.target.value })} placeholder="e.g. 85" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface Props extends ListProps {
  // Show the heading + Add button + empty message (a standalone editor, e.g. a faculty member's own Teaching Load).
  title?: string;
}

// Standalone editor - what a faculty member sees when editing their own Teaching Load: only Previous Teaching
// Assignments (the current assignments are set by their HOD and stay read-only for them).
export function PreviousTeachingAssignmentsEditor({ value, onChange, title = "Previous Teaching Assignments" }: Props) {
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, newPreviousTeachingRecord()])}>
          <Plus className="h-3.5 w-3.5 mr-1" />Add Previous Teaching Assignment
        </Button>
      </div>
      {value.length === 0 && <p className="text-xs text-muted-foreground">No previous teaching assignments added yet.</p>}
      <PreviousTeachingRecordList value={value} onChange={onChange} />
    </div>
  );
}
