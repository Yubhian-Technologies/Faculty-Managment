"use client";

import { useState } from "react";
import { CheckCircle2, RotateCcw, Send, Undo2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { bankStage, STAGE_CLASS, STAGE_LABEL, type ApprovalAction } from "@/lib/midBank/approval";
import type { MidQuestionBank } from "@/types";

// The HOD-approval strip on a question bank: its stage and history for
// everyone (the Exam Cell sees banks before approval too); Submit / Withdraw
// for the faculty preparing it; Approve / Return (with remarks) for the
// branch's HOD. The server decides - these buttons only offer what it allows.

const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
const ACTION_TEXT: Record<string, string> = { SUBMITTED: "submitted", APPROVED: "approved", RETURNED: "returned", WITHDRAWN: "withdrew the submission" };

export function ApprovalPanel({ bank, isOwner, isHod, onChanged }: { bank: MidQuestionBank; isOwner: boolean; isHod: boolean; onChanged: () => void }) {
  const stage = bankStage(bank);
  const [confirm, setConfirm] = useState<ApprovalAction | null>(null);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const history = bank.approvalHistory ?? [];
  const last = history[history.length - 1];

  async function run() {
    if (!confirm) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/college/mid-question-banks/${encodeURIComponent(bank.id)}/approval`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: confirm, remarks }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      toast({ variant: "success", title: { submit: "Submitted to the HOD", withdraw: "Submission withdrawn", approve: "Approved - the Exam Cell can now use it", return: "Returned to the faculty" }[confirm] });
      setConfirm(null); setRemarks("");
      onChanged();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = isOwner && (stage === "READY" || (stage === "RETURNED" && bank.status === "COMPLETE"));
  const hint =
    stage === "IN_PROGRESS" ? (isOwner ? "Complete every unit, then submit it to your HOD for approval." : "Being prepared.")
    : stage === "READY" ? (isOwner ? "Every unit is complete - submit it to your HOD for approval." : "Complete, not yet submitted to the HOD.")
    : stage === "SUBMITTED" ? (isHod ? "Review the questions below, then approve it or return it with remarks." : "With the HOD for approval - it can't be changed meanwhile.")
    : stage === "RETURNED" ? (isOwner ? "Make the changes asked for, then submit it again." : "Returned to the faculty for changes.")
    : "Approved by the HOD - the Exam Cell uses it for the question papers.";

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STAGE_CLASS[stage]}`}>{STAGE_LABEL[stage]}</span>
          <p className="flex-1 text-sm text-muted-foreground">{hint}</p>
          <div className="flex flex-wrap gap-2">
            {canSubmit && <Button size="sm" onClick={() => setConfirm("submit")}><Send className="mr-1.5 h-4 w-4" />Submit to HOD</Button>}
            {isOwner && stage === "SUBMITTED" && <Button size="sm" variant="outline" onClick={() => setConfirm("withdraw")}><Undo2 className="mr-1.5 h-4 w-4" />Withdraw</Button>}
            {isHod && stage === "SUBMITTED" && (
              <>
                <Button size="sm" variant="outline" onClick={() => setConfirm("return")}><RotateCcw className="mr-1.5 h-4 w-4" />Return</Button>
                <Button size="sm" onClick={() => setConfirm("approve")}><CheckCircle2 className="mr-1.5 h-4 w-4" />Approve</Button>
              </>
            )}
          </div>
        </div>
        {last?.action === "RETURNED" && last.remarks && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"><b>HOD&rsquo;s remarks:</b> {last.remarks}</p>
        )}
        {history.length > 0 && (
          <ul className="space-y-0.5 border-t pt-2 text-xs text-muted-foreground">
            {[...history].reverse().map((h, i) => <li key={i}>{fmt(h.at)} · <span className="text-foreground">{h.byName}</span> {ACTION_TEXT[h.action] ?? h.action.toLowerCase()}{h.remarks ? ` - "${h.remarks}"` : ""}</li>)}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => { if (!o) { setConfirm(null); setRemarks(""); } }}
        title={{ submit: "Submit to the HOD?", withdraw: "Withdraw the submission?", approve: "Approve this question bank?", return: "Return it to the faculty?" }[confirm ?? "submit"]}
        description={{
          submit: "The HOD reviews it; it can't be edited while with them. You can withdraw it until they decide.",
          withdraw: "It comes back to you for editing; submit it again when ready.",
          approve: "It goes to the Exam Cell and is used for the question papers. It can't be changed after this.",
          return: "The faculty can edit it again and resubmit. Say what needs changing.",
        }[confirm ?? "submit"]}
        confirmLabel={{ submit: "Submit", withdraw: "Withdraw", approve: "Approve", return: "Return" }[confirm ?? "submit"]}
        confirmDisabled={confirm === "return" && !remarks.trim()}
        loading={busy}
        onConfirm={run}
      >
        {(confirm === "return" || confirm === "approve") && (
          <Textarea aria-label="Remarks" placeholder={confirm === "return" ? "What needs changing (required)" : "Remarks (optional)"} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        )}
      </ConfirmDialog>
    </Card>
  );
}
