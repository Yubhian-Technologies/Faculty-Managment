import { isAllBranches, scopeBranches } from "@/lib/midBank/assignments";
import { isDeadlineLocked } from "@/lib/midBank/deadline";

// "Branches that prepare and approve their own Mid papers" for a subject that has a Subject Department
// (Subject.ownBranchPapers). Switching a branch over (or back) moves who assigns the setters and who approves -
// so it is refused while that branch has work in flight that the other HOD started or would have to finish.

export const OWN_BRANCH_PAPERS_MAX = 10;

interface AssignmentLike { branch: string; branches?: string[]; facultyIds?: string[]; deadlineId: string }
interface BankLike { branch: string; branches?: string[]; deadlineId: string; withdrawn?: unknown; approval?: string }
interface DeadlineLike { deadline: string; midNumber?: number }

// Does a paper / assignment of `scope` cover `branch`? (one branch, a group "A + B", or all branches)
const covers = (scope: { branch: string; branches?: string[] }, branch: string) =>
  isAllBranches(scope.branch) || scope.branch === branch || (scope.branches ?? scopeBranches(scope.branch) ?? []).includes(branch);

/**
 * Why `branches` (the ones being switched over or back) can't be switched now - [] when they can.
 *  - setters assigned for it in a deadline that is still open (the other HOD's assignment would be stranded);
 *  - a question bank / paper set for it that is not yet approved (its approval would change hands mid-way).
 * Approved and withdrawn papers, and assignments of closed deadlines, are history and don't block.
 */
export function ownBranchPaperBlockers(
  branches: string[],
  assignments: AssignmentLike[],
  banks: BankLike[],
  deadlines: ReadonlyMap<string, DeadlineLike>,
  today?: string,
): string[] {
  const out: string[] = [];
  const midOf = (deadlineId: string) => {
    const n = deadlines.get(deadlineId)?.midNumber;
    return n ? `Mid ${n}` : "a Mid";
  };
  for (const b of branches) {
    const assigned = assignments.find((a) => (a.facultyIds?.length ?? 0) > 0 && covers(a, b)
      && deadlines.has(a.deadlineId) && !isDeadlineLocked(deadlines.get(a.deadlineId)!.deadline, today));
    if (assigned) {
      out.push(`${b}: setters are already assigned for ${midOf(assigned.deadlineId)}${isAllBranches(assigned.branch) ? " (one paper for all branches)" : ""}. Remove that assignment first.`);
      continue;
    }
    const open = banks.find((k) => !k.withdrawn && k.approval !== "APPROVED" && covers(k, b));
    if (open) out.push(`${b}: a paper for ${midOf(open.deadlineId)} is being prepared or waiting for approval. Let it be approved (or withdrawn) first.`);
  }
  return out;
}
