import type { ExamConfiguration, InternalExamMarkEntry } from "@/types";

export function activeComponentIds(config: ExamConfiguration): string[] {
  return config.components.filter((c) => c.isActive).map((c) => c.id);
}

// A student's entry only counts as "entered" once every currently-active
// component has a value — matches the "X out of Y students" completion
// count shown on the Faculty Dashboard.
export function isEntryComplete(entry: InternalExamMarkEntry, activeIds: string[]): boolean {
  if (activeIds.length === 0) return false;
  return activeIds.every((id) => entry.componentMarks[id] != null);
}

export function countEntered(entries: InternalExamMarkEntry[], config: ExamConfiguration): number {
  const ids = activeComponentIds(config);
  return entries.filter((e) => isEntryComplete(e, ids)).length;
}
