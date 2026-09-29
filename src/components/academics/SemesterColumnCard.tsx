"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { BookOpen, CheckCircle2, AlertCircle, ArrowRight, Calendar, Sparkles } from "lucide-react";
import type { SemesterDuration, SubjectSemesterAssignment } from "@/types";

interface SemesterColumnCardProps {
  semester: number;
  duration?: SemesterDuration;
  assignments: SubjectSemesterAssignment[];
  onClick: () => void;
  disabled?: boolean;
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

  // Format dates if available
  const dateRange = useMemo(() => {
    if (!duration?.startDate || !duration?.endDate) return null;
    try {
      const start =
        typeof duration.startDate === "object" && "toDate" in duration.startDate
          ? duration.startDate.toDate()
          : new Date(duration.startDate as unknown as string);
      const end =
        typeof duration.endDate === "object" && "toDate" in duration.endDate
          ? duration.endDate.toDate()
          : new Date(duration.endDate as unknown as string);

      return `${start.toLocaleDateString(undefined, {
        month: "short",
      })} – ${end.toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      })}`;
    } catch {
      return null;
    }
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
      className={`group relative flex flex-col justify-between rounded-xl border p-3.5 transition-all outline-none ${
        disabled
          ? "opacity-60 cursor-not-allowed bg-muted/20 border-border"
          : "cursor-pointer bg-card/80 hover:bg-muted/40 hover:border-primary/50 hover:shadow-xs focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      } ${
        count > 0
          ? "border-border/80"
          : "border-dashed border-amber-300/80 bg-amber-50/20 dark:bg-amber-950/10"
      }`}
    >
      <div>
        {/* Top line: Semester title and count badge */}
        <div className="flex items-center justify-between gap-1.5 mb-1.5">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors">
              Semester {semester}
            </span>
          </div>

          <Badge
            variant="outline"
            className={`text-[10px] font-medium px-1.5 py-0 gap-1 rounded-md shrink-0 ${
              count > 0
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
            }`}
          >
            {count > 0 ? (
              <>
                <CheckCircle2 className="h-2.5 w-2.5" />
                {count} {count === 1 ? "subj" : "subjs"}
              </>
            ) : (
              <>
                <AlertCircle className="h-2.5 w-2.5" />
                0 subj
              </>
            )}
          </Badge>
        </div>

        {/* Date range if configured */}
        {dateRange && (
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground mb-1.5">
            <Calendar className="h-3 w-3 shrink-0" />
            <span className="truncate">{dateRange}</span>
          </p>
        )}
      </div>

      {/* Bottom stats & prompt */}
      <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between text-[11px]">
        {count > 0 ? (
          <span className="font-medium text-muted-foreground text-[10px]">
            <span className="font-bold text-foreground">{totalCredits}</span> Credits
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground font-medium">
            0 Credits
          </span>
        )}

        <span className="text-[10px] font-medium text-primary flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
          View subjects
          <ArrowRight className="h-2.5 w-2.5" />
        </span>
      </div>
    </div>
  );
}
