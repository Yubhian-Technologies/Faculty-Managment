"use client";

import { Users, TrendingUp, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { FacultyRequirementResult } from "@/app/api/college/faculty-requirement/route";

interface Props {
  data: FacultyRequirementResult;
  highlightDesignation?: string | null; // key like "PROFESSOR" — highlights that row
  compact?: boolean;
}

function StatusIcon({ gap, surplus }: { gap: number; surplus: number }) {
  if (gap > 0) return <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />;
  if (surplus > 0) return <TrendingUp className="h-4 w-4 text-blue-500 shrink-0" />;
  return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
}

function rowBg(gap: number, surplus: number, highlight: boolean) {
  if (highlight) return "bg-primary/5 border-l-2 border-primary";
  if (gap > 0) return "bg-red-50/60";
  if (surplus > 0) return "bg-blue-50/40";
  return "";
}

export function FacultyRequirementPanel({ data, highlightDesignation, compact }: Props) {
  const noStudents = data.totalStudents === 0;

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-muted/40 border-b">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold text-sm">Faculty Requirement — {data.department}</span>
        </div>
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="font-medium">Ratio 1:{data.studentFacultyRatio}</span>
          <span>·</span>
          <span className="font-medium">Cadre {data.cadreRatio}</span>
        </div>
      </div>

      {/* No sections yet */}
      {noStudents && (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
          <Info className="h-4 w-4 shrink-0" />
          No sections with students found for this department. Add sections and student counts first.
        </div>
      )}

      {!noStudents && (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-3 divide-x border-b text-center text-sm">
            <div className="py-3 px-2">
              <p className="text-lg font-bold">{data.totalStudents}</p>
              <p className="text-xs text-muted-foreground">Students</p>
            </div>
            <div className="py-3 px-2">
              <p className="text-lg font-bold">{data.totalRequired}</p>
              <p className="text-xs text-muted-foreground">Required</p>
            </div>
            <div className="py-3 px-2">
              <p className={`text-lg font-bold ${data.totalGap > 0 ? "text-red-600" : "text-green-600"}`}>
                {data.totalGap > 0 ? `−${data.totalGap}` : "✓ Met"}
              </p>
              <p className="text-xs text-muted-foreground">Overall Gap</p>
            </div>
          </div>

          {/* Cadre table */}
          <div className="divide-y">
            {/* Column headers */}
            {!compact && (
              <div className="grid grid-cols-5 gap-2 px-4 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/20">
                <span className="col-span-2">Designation</span>
                <span className="text-center">Required</span>
                <span className="text-center">Current</span>
                <span className="text-center">Gap</span>
              </div>
            )}

            {data.cadre.map((c) => {
              const highlight = highlightDesignation === c.key;
              return (
                <div
                  key={c.key}
                  className={`grid grid-cols-5 gap-2 items-center px-4 py-3 text-sm transition-colors ${rowBg(c.gap, c.surplus, highlight)}`}
                >
                  <div className="col-span-2 flex items-center gap-2">
                    <StatusIcon gap={c.gap} surplus={c.surplus} />
                    <span className={highlight ? "font-semibold" : ""}>{c.label}</span>
                    <span className="text-[10px] text-muted-foreground hidden sm:inline">(×{c.cadreRatioPart})</span>
                  </div>
                  <p className="text-center font-medium">{c.required}</p>
                  <p className="text-center">{c.current}</p>
                  <p className={`text-center font-semibold ${
                    c.gap > 0 ? "text-red-600" : c.surplus > 0 ? "text-blue-600" : "text-green-600"
                  }`}>
                    {c.gap > 0 ? `−${c.gap}` : c.surplus > 0 ? `+${c.surplus}` : "✓"}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 px-4 py-2.5 border-t bg-muted/20 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-red-500" /> Shortage</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-500" /> Met</span>
            <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3 text-blue-500" /> Surplus (cannot substitute lower cadre)</span>
          </div>
        </>
      )}
    </div>
  );
}
