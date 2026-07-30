"use client";

import type { TeachingLoadRow } from "@/lib/teaching/buildTeachingLoadRows";

interface Props {
  rows: TeachingLoadRow[];
}

// Read-only preview of the same Teaching Load table the resume renders —
// current course/section assignments plus Module 8's present/past tenure
// records — so what the HOD sees here matches what gets downloaded.
export function TeachingLoadTable({ rows }: Props) {
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">No teaching load data yet — add current teaching assignments above or past/present records under Academic Profile.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="p-2 text-left font-medium text-muted-foreground whitespace-nowrap">Academic Year</th>
            <th className="p-2 text-left font-medium text-muted-foreground whitespace-nowrap">Course Name</th>
            <th className="p-2 text-left font-medium text-muted-foreground whitespace-nowrap">Year (Class)</th>
            <th className="p-2 text-left font-medium text-muted-foreground whitespace-nowrap">Section</th>
            <th className="p-2 text-left font-medium text-muted-foreground whitespace-nowrap">Semester</th>
            <th className="p-2 text-left font-medium text-muted-foreground whitespace-nowrap">Subject</th>
            <th className="p-2 text-left font-medium text-muted-foreground whitespace-nowrap">Hr/Week</th>
            <th className="p-2 text-left font-medium text-muted-foreground whitespace-nowrap">Pass %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`border-b last:border-b-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
              <td className="p-2 whitespace-nowrap">{r.academicYear || "—"}</td>
              <td className="p-2 whitespace-nowrap">{r.courseName || "—"}</td>
              <td className="p-2 whitespace-nowrap">{r.year ?? "—"}</td>
              <td className="p-2 whitespace-nowrap">{r.section || "—"}</td>
              <td className="p-2 whitespace-nowrap">{r.semester ?? "—"}</td>
              <td className="p-2 whitespace-nowrap">{r.subject || "—"}</td>
              <td className="p-2 whitespace-nowrap">{r.hoursPerWeek ?? "—"}</td>
              <td className="p-2 whitespace-nowrap">{r.passPercentage != null ? `${r.passPercentage}%` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
