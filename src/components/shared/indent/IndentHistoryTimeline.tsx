import { formatDate } from "@/lib/utils";
import { INDENT_STATUS_LABELS, type IndentApprovalAction } from "@/types";

export function IndentHistoryTimeline({ history }: { history: IndentApprovalAction[] | undefined }) {
  if (!history?.length) {
    return <p className="text-xs text-muted-foreground">No steps recorded yet.</p>;
  }
  return (
    <div className="space-y-2">
      {history.map((h, i) => (
        <div key={i} className="rounded-md border p-3 text-sm space-y-1">
          <div className="flex justify-between font-medium">
            <span>{INDENT_STATUS_LABELS[h.action] ?? h.action}</span>
            <span className="text-xs text-muted-foreground">{formatDate(h.at)}</span>
          </div>
          <p className="text-xs text-muted-foreground">by {h.byName} ({h.byRole})</p>
          {h.remarks && <p className="text-muted-foreground">{h.remarks}</p>}
        </div>
      ))}
    </div>
  );
}
