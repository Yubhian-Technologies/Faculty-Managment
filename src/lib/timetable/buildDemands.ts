import type { Subject, SubjectType, TeachingAssignment, TimetableRules } from "@/types";

// Turns "who teaches what to this section" into the units the solver places.
//
// A THEORY/TUTORIAL/PROJECT subject with hoursPerWeek = 4 becomes 4 independent
// single-period demands. A PRACTICAL becomes ceil(hours / labBlockSize) blocks of
// labBlockSize contiguous periods each (your 3-continuous-hour lab rule).

export interface Demand {
  /** Stable key for diagnostics and for grouping a lab's periods together. */
  key: string;
  assignmentId: string;
  facultyId: string;
  facultyName: string;
  subjectId: string;
  subjectName: string;
  subjectType: SubjectType;
  /** Contiguous periods this demand occupies: 1 for theory, labBlockSize for a lab. */
  blockSize: number;
}

export interface BuildDemandsResult {
  demands: Demand[];
  /** Subjects assigned to this section that have no matching Subject doc. */
  missingSubjects: string[];
}

export function buildDemands(
  assignments: TeachingAssignment[],
  subjectsById: Map<string, Subject>,
  rules: TimetableRules,
): BuildDemandsResult {
  const demands: Demand[] = [];
  const missingSubjects: string[] = [];

  for (const a of assignments) {
    // Historical rows carry no weekly schedule - they are a record of past
    // teaching, not something to place (see TeachingAssignment.isPast).
    if (a.isPast) continue;

    const subject = subjectsById.get(a.subjectId);
    if (!subject) {
      missingSubjects.push(a.subjectName || a.subjectId);
      continue;
    }

    // The assignment's hoursPerWeek wins when set - an HOD may allot a subject
    // fewer/more hours for a particular section than the subject's own default.
    const hours = a.hoursPerWeek || subject.hoursPerWeek || 0;
    if (hours <= 0) continue;

    if (subject.type === "PRACTICAL") {
      const blockSize = Math.max(1, rules.labBlockSize);
      const blocks = Math.ceil(hours / blockSize);
      for (let b = 0; b < blocks; b++) {
        demands.push({
          key: `${a.id}#lab${b}`,
          assignmentId: a.id,
          facultyId: a.facultyId,
          facultyName: a.facultyName,
          subjectId: a.subjectId,
          subjectName: a.subjectName || subject.name,
          subjectType: subject.type,
          blockSize,
        });
      }
    } else {
      for (let h = 0; h < hours; h++) {
        demands.push({
          key: `${a.id}#h${h}`,
          assignmentId: a.id,
          facultyId: a.facultyId,
          facultyName: a.facultyName,
          subjectId: a.subjectId,
          subjectName: a.subjectName || subject.name,
          subjectType: subject.type,
          blockSize: 1,
        });
      }
    }
  }

  return { demands, missingSubjects };
}

/** Total periods all demands need — compared against free grid capacity. */
export function totalPeriodsRequired(demands: Demand[]): number {
  return demands.reduce((sum, d) => sum + d.blockSize, 0);
}
