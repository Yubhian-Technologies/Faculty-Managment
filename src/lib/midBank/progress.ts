// How far a question bank deadline is, across EVERY section that should have a
// bank - not just the banks already started. A section in no bank counts as 0 %,
// a section in a bank counts as that bank's share of complete questions. Used by
// the Exam Cell overview and progress pages.

export interface ProgressGroup {
  sections: { bankId: string | null }[];
  banks: { id: string; status: string; completeCount: number; totalCount: number; approval?: string | null }[];
}

export interface DeadlineProgress {
  subjects: number;
  subjectsStarted: number;
  /** Subjects (branch + subject) whose every section is in a complete bank. */
  subjectsComplete: number;
  sections: number;
  covered: number;
  /** Sections whose bank is complete. */
  ready: number;
  banks: number;
  banksComplete: number;
  /** Banks waiting for the HOD / approved by the HOD. */
  banksSubmitted: number;
  banksApproved: number;
  /** Subjects whose every section is in an HOD-approved bank. */
  subjectsApproved: number;
  /** 0-100, over all sections. */
  pct: number;
}

export function deadlineProgress(groups: ProgressGroup[]): DeadlineProgress {
  const banks = groups.flatMap((g) => g.banks);
  const byId = new Map(banks.map((b) => [b.id, b]));
  const sections = groups.flatMap((g) => g.sections);
  let sum = 0;
  let ready = 0;
  for (const s of sections) {
    const b = s.bankId ? byId.get(s.bankId) : undefined;
    if (!b) continue;
    sum += b.status === "COMPLETE" ? 1 : b.totalCount ? Math.min(1, b.completeCount / b.totalCount) : 0;
    if (b.status === "COMPLETE") ready++;
  }
  return {
    subjects: groups.length,
    subjectsStarted: groups.filter((g) => g.banks.length > 0).length,
    subjectsComplete: groups.filter((g) => g.sections.length > 0 && g.sections.every((s) => s.bankId && byId.get(s.bankId)?.status === "COMPLETE")).length,
    sections: sections.length,
    covered: sections.filter((s) => s.bankId).length,
    ready,
    banks: banks.length,
    banksComplete: banks.filter((b) => b.status === "COMPLETE").length,
    banksSubmitted: banks.filter((b) => b.approval === "SUBMITTED").length,
    banksApproved: banks.filter((b) => b.approval === "APPROVED").length,
    subjectsApproved: groups.filter((g) => g.sections.length > 0 && g.sections.every((s) => s.bankId && byId.get(s.bankId)?.approval === "APPROVED")).length,
    pct: sections.length ? Math.floor((sum / sections.length) * 100) : 0,
  };
}
