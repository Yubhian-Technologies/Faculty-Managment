"use client";

import { useState } from "react";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { useCollegeInfo } from "@/hooks/useCollegeInfo";
import { downloadTeachingLoadPdf, downloadTeachingLoadXlsx } from "@/lib/teaching/teachingLoadExport";
import { formatClassColumn, type TeachingLoadRow, type TeachingLoadGroups } from "@/lib/teaching/buildTeachingLoadRows";
import { formatPassPercentage, PREVIOUS_TEACHING_SOURCE_LABELS } from "@/lib/faculty/previousTeaching";
import type { PreviousTeachingAssignment } from "@/types";

interface Props {
  groups: TeachingLoadGroups;
  // Free-text Previous Teaching Assignments from the faculty record - shown above any earlier course/section/subject entries.
  previous?: PreviousTeachingAssignment[];
  // Printed in the downloads' heading and file name.
  facultyName?: string;
  department?: string;
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
export function TeachingLoadTable({ groups, previous = [], facultyName, department }: Props) {
  const [busy, setBusy] = useState<"" | "pdf" | "xlsx">("");
  const { collegeInfo } = useCollegeInfo();
  if (groups.current.length === 0 && groups.past.length === 0 && previous.length === 0) {
    return <p className="text-xs text-muted-foreground">No teaching load data yet - add current teaching assignments above or previous/present records under Academic Profile.</p>;
  }

  async function download(kind: "pdf" | "xlsx") {
    setBusy(kind);
    try {
      const input = {
        groups, previous, facultyName, department,
        college: collegeInfo ? { name: collegeInfo.name, code: collegeInfo.code, affiliation: collegeInfo.affiliation, address: collegeInfo.address, phone: collegeInfo.phone, logoUrl: collegeInfo.logoUrl } : undefined,
      };
      const base = `Teaching-Load${facultyName ? `-${facultyName.replace(/[^A-Za-z0-9]+/g, "-")}` : ""}`;
      if (kind === "pdf") await downloadTeachingLoadPdf(input, base);
      else await downloadTeachingLoadXlsx(input, base);
    } catch {
      toast({ variant: "destructive", title: "Download failed" });
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => void download("pdf")} disabled={busy !== ""}>
          <FileDown className="h-3.5 w-3.5 mr-1.5" />{busy === "pdf" ? "Generating PDF..." : "PDF"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void download("xlsx")} disabled={busy !== ""}>
          <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />{busy === "xlsx" ? "Exporting Excel..." : "Excel"}
        </Button>
      </div>
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
