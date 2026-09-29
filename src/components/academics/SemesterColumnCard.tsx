"use client";

import { useMemo } from "react";
import type { SemesterDuration, SubjectSemesterAssignment } from "@/types";

interface SemesterColumnCardProps {
  semester: number;
  duration?: SemesterDuration;
  assignments: SubjectSemesterAssignment[];
  onClick: () => void;
  disabled?: boolean;
}

function parseFirestoreDate(val: unknown): Date | null {
  if (!val) return null;
  if (typeof val === "object") {
    if ("toDate" in val && typeof (val as { toDate: () => Date }).toDate === "function") {
      const d = (val as { toDate: () => Date }).toDate();
      return isNaN(d.getTime()) ? null : d;
    }
    if ("_seconds" in val && typeof (val as { _seconds: number })._seconds === "number") {
      const d = new Date((val as { _seconds: number })._seconds * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
    if ("seconds" in val && typeof (val as { seconds: number }).seconds === "number") {
      const d = new Date((val as { seconds: number }).seconds * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
  }
  if (typeof val === "string" || typeof val === "number") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function SemesterColumnCard({
  semester,
  duration,
  assignments,
  onClick,
  disabled = false,
}: SemesterColumnCardProps) {
  const count = assignments.length;

  const totalCredits = useMemo(() => {
    return assignments.reduce((acc, curr) => acc + (curr.credits ?? 0), 0);
  }, [assignments]);

  const dateRange = useMemo(() => {
    if (!duration?.startDate || !duration?.endDate) return null;
    const start = parseFirestoreDate(duration.startDate);
    const end = parseFirestoreDate(duration.endDate);
    if (!start || !end) return null;

    return `${start.toLocaleDateString(undefined, {
      month: "short",
    })} – ${end.toLocaleDateString(undefined, {
      month: "short",
      year: "numeric",
    })}`;
  }, [duration]);

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`Semester ${semester}: ${count} subjects assigned. Click to view.`}
      className={`group relative flex flex-col justify-between rounded-lg border p-4 transition-all outline-none ${
        disabled
          ? "opacity-60 cursor-not-allowed bg-muted/20 border-border"
          : "cursor-pointer bg-card hover:bg-muted/30 hover:border-primary/50 hover:shadow-xs focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      } ${
        count > 0 ? "border-border" : "border-border/60 bg-muted/10"
      }`}
    >
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-sm text-foreground">
            Semester {semester}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-0.5 rounded-md border ${
              count > 0
                ? "bg-primary/10 text-primary border-primary/25 dark:bg-primary/20 dark:text-primary dark:border-primary/30"
                : "bg-muted/80 text-muted-foreground border-border"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${count > 0 ? "bg-primary" : "bg-muted-foreground/40"}`} />
            {count} {count === 1 ? "Subject" : "Subjects"}
          </span>
        </div>

        {dateRange && (
          <p className="text-xs text-muted-foreground">
            {dateRange}
          </p>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          <strong className="font-semibold text-foreground">{totalCredits}</strong> Credits
        </span>

        <span className="font-medium text-primary group-hover:underline">
          View subjects →
        </span>
      </div>
    </div>
  );
}
