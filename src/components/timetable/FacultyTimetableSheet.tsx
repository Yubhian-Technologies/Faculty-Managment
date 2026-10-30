"use client";

import { Fragment } from "react";
import type { TeachingAssignment, TimetableSlot } from "@/types";
import { resolveLogoUrl } from "@/lib/timetable/logoAsset";
import { resolveSignatureRows } from "@/lib/timetable/signatureAuthority";
import { buildFacultyClassRows, collegeHeading, departmentHeading, facultyTimetableTitle } from "@/lib/timetable/timetableHeader";

// The on-screen counterparts of the faculty timetable PDF's letterhead and bottom
// section (facultyTimetablePdf.ts), so the page reads like the file it downloads.

export interface FacultyTimetableCollege {
  name?: string;
  affiliation?: string;
  city?: string;
  logoUrl?: string;
  teachingLoadSignatureRows?: string[][];
}

/** The department the slots belong to, as the PDF resolves it. */
export function facultyTimetableDepartment(
  departmentName: string | undefined,
  slots: Pick<TimetableSlot, "assignmentId">[],
  assignments: Map<string, TeachingAssignment>
): string {
  if (departmentName) return departmentName;
  const inGrid = new Set(slots.map((s) => s.assignmentId));
  return Array.from(new Set(Array.from(assignments.values()).filter((a) => inGrid.has(a.id)).map((a) => a.department).filter(Boolean))).join(", ");
}

export function FacultyTimetableLetterhead({
  college,
  facultyName,
  departmentName,
  academicYear,
  semesterLabel,
}: {
  college?: FacultyTimetableCollege;
  facultyName: string;
  departmentName: string;
  academicYear?: string;
  semesterLabel: string;
}) {
  const deptHeading = departmentHeading(departmentName);
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={resolveLogoUrl(college?.logoUrl)} alt="" className="h-12 w-12 shrink-0 object-contain" />
        <div className="min-w-0 flex-1 text-center">
          {college?.name && <h3 className="text-sm sm:text-base font-bold text-foreground break-words">{collegeHeading(college.name, college.city)}</h3>}
          {college?.affiliation && <p className="text-xs font-bold text-foreground break-words">{college.affiliation}</p>}
          {deptHeading && <p className="text-xs font-bold text-foreground break-words">{deptHeading}</p>}
          <p className="text-xs font-bold text-foreground">{facultyTimetableTitle(academicYear, semesterLabel)}</p>
        </div>
        <div className="hidden sm:block h-12 w-12 shrink-0" aria-hidden />
      </div>
      <p className="mt-3 text-center text-sm font-bold text-foreground">Faculty: {facultyName}</p>
    </div>
  );
}

export function FacultyTimetableFooter({
  college,
  departmentName,
  slots,
  assignmentById,
}: {
  college?: FacultyTimetableCollege;
  departmentName: string;
  slots: Pick<TimetableSlot, "assignmentId" | "semester">[];
  assignmentById: Map<string, TeachingAssignment>;
}) {
  const rows = buildFacultyClassRows(slots, assignmentById.values());
  const signatures = resolveSignatureRows(college?.teachingLoadSignatureRows, departmentName);
  return (
    <div className="rounded-lg border bg-card px-4 py-3 space-y-4">
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-xs">
            <colgroup><col style={{ width: "8%" }} /><col style={{ width: "28%" }} /><col style={{ width: "16%" }} /><col style={{ width: "48%" }} /></colgroup>
            <thead>
              <tr className="text-left font-bold text-foreground">
                <th className="px-1 py-1 text-center">S.No</th>
                <th className="px-1 py-1">Class</th>
                <th className="px-1 py-1">Sub Acronym</th>
                <th className="px-1 py-1">Subject Name</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <Fragment key={`${r.cls}|${r.acr}|${r.name}`}>
                  <tr className="text-foreground">
                    <td className="px-1 py-0.5 text-center">{i + 1}</td>
                    <td className="px-1 py-0.5 break-words">{r.cls}</td>
                    <td className="px-1 py-0.5 break-words">{r.acr}</td>
                    <td className="px-1 py-0.5 break-words">{r.name}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {signatures.map((row, i) => (
        <div key={i} className="flex justify-between gap-2 pt-6 text-center text-xs font-bold text-foreground">
          {row.map((label, j) => (
            <div key={`${label}-${j}`} className="flex-1 min-w-0 break-words">{label}</div>
          ))}
        </div>
      ))}
    </div>
  );
}
