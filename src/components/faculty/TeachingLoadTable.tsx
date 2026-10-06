"use client";

import { formatClassColumn, type TeachingLoadRow, type TeachingLoadGroups } from "@/lib/teaching/buildTeachingLoadRows";
import { formatPassPercentage, PREVIOUS_TEACHING_SOURCE_LABELS } from "@/lib/faculty/previousTeaching";
import type { PreviousTeachingAssignment } from "@/types";

interface Props {
  groups: TeachingLoadGroups;
  // Free-text Previous Teaching Assignments from the faculty record - shown above any earlier course/section/subject entries.
  previous?: PreviousTeachingAssignment[];
}

function PreviousTable({ rows }: { rows: PreviousTeachingAssignment[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-muted/40">
            {["Internal / External", "Academic Year", "Course", "Year", "Semester", "Subject", "Passing %"].map((h) => (
              <th key={h} className="p-2 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={`border-b last:border-b-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
              <td className="p-2 whitespace-nowrap">{PREVIOUS_TEACHING_SOURCE_LABELS[r.source]}{r.source === "EXTERNAL" && r.collegeName ? ` - ${r.collegeName}` : ""}</td>
              <td className="p-2 whitespace-nowrap">{r.academicYear || "-"}</td>
              <td className="p-2 whitespace-nowrap">{r.course || "-"}</td>
              <td className="p-2 whitespace-nowrap">{r.year || "-"}</td>
              <td className="p-2 whitespace-nowrap">{r.semester || "-"}</td>
              <td className="p-2">{r.subject || "-"}</td>
              <td className="p-2 whitespace-nowrap">{formatPassPercentage(r.passPercentage) || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LoadTable({ rows, showPastColumns }: { rows: TeachingLoadRow[]; showPastColumns: boolean }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="p-2 text-left font-medium text-muted-foreground whitespace-nowrap">Academic Year</th>
            <th className="p-2 text-left font-medium text-muted-foreground whitespace-nowrap">Year / Branch / Semester / Section</th>
            <th className="p-2 text-left font-medium text-muted-foreground whitespace-nowrap">Subject</th>
            <th className="p-2 text-left font-medium text-muted-foreground whitespace-nowrap">Hours Per Week</th>
            {showPastColumns && <th className="p-2 text-left font-medium text-muted-foreground whitespace-nowrap">Student Pass %</th>}
            {showPastColumns && <th className="p-2 text-left font-medium text-muted-foreground whitespace-nowrap">Student Feedback %</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`border-b last:border-b-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
              <td className="p-2 whitespace-nowrap">{r.academicYear || "-"}</td>
              <td className="p-2 whitespace-nowrap">{formatClassColumn(r) || "-"}</td>
              <td className="p-2 whitespace-nowrap">{r.subject || "-"}</td>
              <td className="p-2 whitespace-nowrap">{r.hoursPerWeek ?? "-"}</td>
              {showPastColumns && <td className="p-2 whitespace-nowrap">{r.passPercentage != null ? `${r.passPercentage}%` : "-"}</td>}
              {showPastColumns && <td className="p-2 whitespace-nowrap">{r.studentFeedback != null ? `${r.studentFeedback}%` : "-"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Read-only preview of the same Teaching Load tables the resume renders - kept
// as two separate tables (Current vs Past) rather than intermixed, matching the
// resume's layout, so what the HOD sees here matches what gets downloaded.
export function TeachingLoadTable({ groups, previous = [] }: Props) {
  if (groups.current.length === 0 && groups.past.length === 0 && previous.length === 0) {
    return <p className="text-xs text-muted-foreground">No teaching load data yet - add current teaching assignments above or previous/present records under Academic Profile.</p>;
  }

  return (
    <div className="space-y-4">
      {groups.current.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current Teaching Assignments</p>
          <LoadTable rows={groups.current} showPastColumns={false} />
        </div>
      )}
      {(groups.past.length > 0 || previous.length > 0) && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Previous Teaching Assignments</p>
          {previous.length > 0 && <PreviousTable rows={previous} />}
          {groups.past.length > 0 && <LoadTable rows={groups.past} showPastColumns />}
        </div>
      )}
    </div>
  );
}
