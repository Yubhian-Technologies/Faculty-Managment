import type { CertificateClearance } from "@/types";

// Pure, no I/O. Deliberately stage-agnostic - no "if stageId === 'HOD'"
// anywhere. Every step/branch's authorization question is the same one:
// "is this actor in the resolved recipient set, and are they not the
// requester themself". That resolved set is computed by configStore's
// resolveRecipientUids before this is called.

export function canDecide(actorUid: string, requesterUid: string, resolvedRecipientUids: string[]): boolean {
  return actorUid !== requesterUid && resolvedRecipientUids.includes(actorUid);
}

export function allBranchesAccepted(branches: CertificateClearance[]): boolean {
  return branches.length > 0 && branches.every((b) => b.status === "ACCEPTED");
}

export function anyBranchRejected(branches: CertificateClearance[]): boolean {
  return branches.some((b) => b.status === "REJECTED");
}
