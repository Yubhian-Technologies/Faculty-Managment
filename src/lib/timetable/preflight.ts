import type { CourseYearTiming, Subject, TeachingAssignment, TimetableRules } from "@/types";
import { isContiguousBlockAvailable } from "./buildGrid";
import { buildDemands, totalPeriodsRequired } from "./buildDemands";

// The "all required conditions satisfied" gate. Runs before the solver so the
// HOD gets a precise, fixable list instead of a failed generation - each check
// names what is wrong and what to do about it.

export interface PreflightIssue {
  severity: "error" | "warning";
  message: string;
}

export interface PreflightResult {
  ready: boolean;               // no errors - Generate may run
  issues: PreflightIssue[];
  requiredPeriods: number;
  availablePeriods: number;
}

export interface PreflightInput {
  timing: CourseYearTiming | null;
  rules: TimetableRules;
  /** Active assignments for THIS section. */
  assignments: TeachingAssignment[];
  /** Every subject defined for this course-year - used to spot uncovered ones. */
  courseYearSubjects: Subject[];
  subjectsById: Map<string, Subject>;
  pinnedCellCount: number;
}

export function preflight(input: PreflightInput): PreflightResult {
  const { timing, rules, assignments, courseYearSubjects, subjectsById, pinnedCellCount } = input;
  const issues: PreflightIssue[] = [];

  if (!timing) {
    return {
      ready: false,
      requiredPeriods: 0,
      availablePeriods: 0,
      issues: [{
        severity: "error",
        message:
          "No period timing is configured for this course year. Set college timings, " +
          "period count and breaks before generating a timetable.",
      }],
    };
  }

  if (rules.workingDays.length === 0) {
    issues.push({ severity: "error", message: "No working days are configured in the timetable rules." });
  }

  const active = assignments.filter((a) => !a.isPast);
  if (active.length === 0) {
    issues.push({
      severity: "error",
      message: "No faculty are assigned to this section yet. Assign subjects in Teaching Assignments first.",
    });
  }

  // Every subject defined for this course-year must have someone teaching it.
  const assignedSubjectIds = new Set(active.map((a) => a.subjectId));
  const uncovered = courseYearSubjects.filter((s) => s.isActive !== false && !assignedSubjectIds.has(s.id));
  for (const s of uncovered) {
    issues.push({
      severity: "error",
      message: `${s.name} (${s.code}) has no faculty assigned for this section.`,
    });
  }

  const { demands, missingSubjects } = buildDemands(active, subjectsById, rules);
  for (const name of missingSubjects) {
    issues.push({
      severity: "error",
      message: `${name} is assigned but its subject record is missing - it has no hours or type to schedule.`,
    });
  }

  // Labs must divide cleanly into blocks and each block must fit the day.
  for (const a of active) {
    const subject = subjectsById.get(a.subjectId);
    if (!subject || subject.type !== "PRACTICAL") continue;
    const hours = a.hoursPerWeek || subject.hoursPerWeek || 0;
    if (hours % rules.labBlockSize !== 0) {
      issues.push({
        severity: "warning",
        message:
          `${subject.name} is a lab with ${hours} hrs/week, which is not a multiple of the ` +
          `${rules.labBlockSize}-period lab block. It will be rounded up to ` +
          `${Math.ceil(hours / rules.labBlockSize) * rules.labBlockSize} periods.`,
      });
    }
    const fitsSomewhere = Array.from({ length: timing.numberOfPeriods }, (_, i) => i + 1).some((start) =>
      isContiguousBlockAvailable(timing, start, rules.labBlockSize, rules.allowLabAcrossBreaks),
    );
    if (!fitsSomewhere) {
      issues.push({
        severity: "error",
        message:
          `${subject.name} needs ${rules.labBlockSize} continuous periods, but no such block exists in a ` +
          `${timing.numberOfPeriods}-period day without crossing a break. Adjust the lab block size, ` +
          `the break positions, or allow labs across breaks.`,
      });
    }
  }

  const requiredPeriods = totalPeriodsRequired(demands);
  const availablePeriods = rules.workingDays.length * timing.numberOfPeriods - pinnedCellCount;

  if (requiredPeriods > availablePeriods) {
    issues.push({
      severity: "error",
      message:
        `This section needs ${requiredPeriods} periods a week but only ${availablePeriods} are free ` +
        `(${rules.workingDays.length} working days x ${timing.numberOfPeriods} periods` +
        (pinnedCellCount ? `, minus ${pinnedCellCount} pinned` : "") + ").",
    });
  } else if (requiredPeriods < availablePeriods * 0.4) {
    issues.push({
      severity: "warning",
      message: `Only ${requiredPeriods} of ${availablePeriods} periods will be filled - the timetable will be sparse.`,
    });
  }

  return {
    ready: !issues.some((i) => i.severity === "error"),
    issues,
    requiredPeriods,
    availablePeriods,
  };
}
