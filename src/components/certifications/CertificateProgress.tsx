import { Fragment } from "react";
import { Check, Clock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CertificateRequest } from "@/types";

// A 3-stage horizontal tracker - Submitted -> Pending -> Completed. The
// request's actual internal flow (HOD, per-department clearances, College
// Office) stays exactly as it was server-side; this view just doesn't walk
// it step by step - every role's own Inbox/IssuanceQueue already shows the
// step that's actually waiting on THEM, so the student's own tracker only
// needs to answer "where does my request stand", not "which of five
// approvers exactly".

type NodeState = "done" | "current" | "rejected" | "upcoming";

function Circle({ state }: { state: NodeState }) {
  return (
    <span
      className={cn(
        "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-background",
        state === "done" && "border-emerald-500 bg-emerald-500 text-white",
        state === "current" && "border-primary text-primary",
        state === "rejected" && "border-red-500 bg-red-500 text-white",
        state === "upcoming" && "border-border text-muted-foreground"
      )}
    >
      {state === "done" && <Check className="h-4 w-4" />}
      {state === "current" && <Clock className="h-4 w-4" />}
      {state === "rejected" && <X className="h-4 w-4" />}
    </span>
  );
}

function Connector({ filled }: { filled: boolean }) {
  return <div className={cn("mt-[15px] h-0.5 min-w-7 flex-1 sm:min-w-12", filled ? "bg-emerald-300 dark:bg-emerald-800" : "bg-border")} />;
}

function HNode({ state, label, sub }: { state: NodeState; label: string; sub?: string }) {
  return (
    <div className="flex w-28 shrink-0 flex-col items-center gap-2 text-center sm:w-32">
      <Circle state={state} />
      <div>
        <p className={cn("text-xs font-medium leading-tight sm:text-sm", state === "upcoming" ? "text-muted-foreground" : "text-foreground")}>{label}</p>
        {sub && <p className="mt-0.5 text-[11px] text-muted-foreground leading-tight">{sub}</p>}
      </div>
    </div>
  );
}

export function CertificateProgress({ request }: { request: CertificateRequest }) {
  const terminalLabel = request.status === "REJECTED" ? "Rejected" : request.status === "CANCELLED" ? "Cancelled" : "Pending";
  const isTerminalStop = request.status === "REJECTED" || request.status === "CANCELLED";

  const nodes: { key: string; label: string; sub?: string; state: NodeState }[] = [
    { key: "submitted", label: "Submitted", sub: request.certificateTypeLabel, state: "done" },
    {
      key: "pending",
      label: terminalLabel,
      state: request.status === "ISSUED" ? "done" : isTerminalStop ? "rejected" : "current",
    },
    {
      key: "completed",
      label: "Completed",
      sub: request.status === "ISSUED" ? request.certificateNumber : undefined,
      state: request.status === "ISSUED" ? "done" : "upcoming",
    },
  ];

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex items-start min-w-max">
        {nodes.map((n, i) => (
          <Fragment key={n.key}>
            {i > 0 && <Connector filled={nodes[i - 1].state === "done"} />}
            <HNode state={n.state} label={n.label} sub={n.sub} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}
