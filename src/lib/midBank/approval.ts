import type { MidBankApproval, MidQuestionBank } from "@/types";

// HOD approval of question banks (pure): one stage per bank, and what each
// person may do with it. Faculty submit a complete bank; the branch's HOD
// approves it (then the Exam Cell's question papers use it) or returns it with
// remarks; the faculty may withdraw a submission the HOD hasn't decided yet.

export type BankStage = "IN_PROGRESS" | "READY" | "SUBMITTED" | "RETURNED" | "APPROVED";

type B = Pick<MidQuestionBank, "status" | "approval">;

export function bankStage(b: B): BankStage {
  if (b.approval === "APPROVED") return "APPROVED";
  if (b.approval === "SUBMITTED") return "SUBMITTED";
  if (b.approval === "RETURNED") return "RETURNED";
  return b.status === "COMPLETE" ? "READY" : "IN_PROGRESS";
}

export const STAGE_LABEL: Record<BankStage, string> = {
  IN_PROGRESS: "In progress",
  READY: "Complete - not submitted",
  SUBMITTED: "Submitted - awaiting HOD",
  RETURNED: "Returned by HOD",
  APPROVED: "Approved by HOD",
};

export const STAGE_CLASS: Record<BankStage, string> = {
  IN_PROGRESS: "bg-primary/10 text-primary",
  READY: "bg-sky-100 text-sky-900",
  SUBMITTED: "bg-amber-100 text-amber-900",
  RETURNED: "bg-red-100 text-red-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
};

export type ApprovalAction = "submit" | "withdraw" | "approve" | "return";

/** The next approval value for an action, or why it isn't allowed. */
export function nextApproval(b: B, action: ApprovalAction, who: { isOwner: boolean; isHod: boolean }, remarks?: string): { approval: MidBankApproval | null } | { error: string } {
  const stage = bankStage(b);
  switch (action) {
    case "submit":
      if (!who.isOwner) return { error: "Only the faculty preparing this bank can submit it" };
      if (stage === "SUBMITTED") return { error: "Already submitted - waiting for the HOD" };
      if (stage === "APPROVED") return { error: "Already approved by the HOD" };
      if (b.status !== "COMPLETE") return { error: "Complete every unit before submitting" };
      return { approval: "SUBMITTED" };
    case "withdraw":
      if (!who.isOwner) return { error: "Only the faculty preparing this bank can withdraw it" };
      if (stage !== "SUBMITTED") return { error: "Only a submission the HOD hasn't decided can be withdrawn" };
      return { approval: null };
    case "approve":
    case "return":
      if (!who.isHod) return { error: "Only the HOD of this branch can approve or return it" };
      if (stage !== "SUBMITTED") return { error: stage === "APPROVED" ? "Already approved" : "It hasn't been submitted for approval" };
      if (action === "return" && !remarks?.trim()) return { error: "Say what needs changing - remarks are required to return it" };
      return { approval: action === "approve" ? "APPROVED" : "RETURNED" };
  }
}

/**
 * A subject (in a branch) as a whole, from its sections and their banks: every
 * section in an approved bank = APPROVED; any bank returned = RETURNED; every
 * section in a submitted / approved bank = SUBMITTED; every section in a
 * complete bank = READY; any bank = IN_PROGRESS; else NOT_STARTED.
 */
export type GroupStage = "NOT_STARTED" | BankStage;
export function groupStage(sections: { bankId: string | null }[], banks: (B & { id: string })[]): GroupStage {
  if (!banks.length) return "NOT_STARTED";
  const stageOf = new Map(banks.map((b) => [b.id, bankStage(b)]));
  const all = (ok: BankStage[]) => sections.length > 0 && sections.every((s) => s.bankId && ok.includes(stageOf.get(s.bankId)!));
  if (all(["APPROVED"])) return "APPROVED";
  if ([...stageOf.values()].includes("RETURNED")) return "RETURNED";
  if (all(["SUBMITTED", "APPROVED"])) return "SUBMITTED";
  if (all(["READY", "SUBMITTED", "APPROVED"])) return "READY";
  return "IN_PROGRESS";
}

export const GROUP_LABEL: Record<GroupStage, string> = { NOT_STARTED: "Not started", ...STAGE_LABEL };
export const GROUP_CLASS: Record<GroupStage, string> = { NOT_STARTED: "bg-muted text-muted-foreground", ...STAGE_CLASS };
