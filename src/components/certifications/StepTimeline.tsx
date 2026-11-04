import { Fragment } from "react";
import { Check, Clock, Undo2, X } from "lucide-react";
import { cn, toDate } from "@/lib/utils";
import type { CertificateRequest } from "@/types";

// Every approval of a configured request, in order: who approved / rejected and when, the step waiting now, and
// what is still to come - so the student (and each approver) sees exactly where it stands.

type State = "done" | "current" | "rejected" | "returned" | "upcoming";

const when = (ts: unknown) => {
  const d = toDate(ts as never);
  return d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
};

function Dot({ state }: { state: State }) {
  return (
    <span className={cn(
      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 bg-background",
      state === "done" && "border-emerald-500 bg-emerald-500 text-white",
      state === "current" && "border-primary text-primary",
      state === "rejected" && "border-red-500 bg-red-500 text-white",
      state === "returned" && "border-orange-500 bg-orange-500 text-white",
      state === "upcoming" && "border-border",
    )}>
      {state === "done" && <Check className="h-3 w-3" />}
      {state === "current" && <Clock className="h-3 w-3" />}
      {state === "rejected" && <X className="h-3 w-3" />}
      {state === "returned" && <Undo2 className="h-3 w-3" />}
    </span>
  );
}

function Row({ state, label, sub }: { state: State; label: string; sub?: string }) {
  return (
    <li className="flex gap-2.5">
      <Dot state={state} />
      <div className="min-w-0">
        <p className={cn("text-sm", state === "upcoming" ? "text-muted-foreground" : "font-medium")}>{label}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </li>
  );
}

export function StepTimeline({ request }: { request: CertificateRequest }) {
  const rows: { key: string; state: State; label: string; sub?: string }[] = [
    { key: "submitted", state: "done", label: "Applied", sub: when(request.createdAt) },
  ];
  request.flow.forEach((step, i) => {
    const s = request.steps[i];
    const isCurrent = i === request.currentStepIndex && (request.status === "IN_PROGRESS" || request.status === "RETURNED");
    if (step.type === "SEQUENTIAL") {
      const st = s?.type === "SEQUENTIAL" ? s : undefined;
      const state: State = st?.status === "APPROVED" ? "done" : st?.status === "REJECTED" ? "rejected"
        : isCurrent ? (request.status === "RETURNED" ? "returned" : "current") : "upcoming";
      const sub = st?.decidedByName
        ? `${st.status === "APPROVED" ? "Approved" : "Rejected"} by ${st.decidedByName} · ${when(st.decidedAt)}${st.remarks ? ` - ${st.remarks}` : ""}`
        : state === "current" ? "Waiting" : state === "returned" ? "Sent back to you for a correction" : undefined;
      rows.push({ key: step.id, state, label: step.label, sub });
    } else {
      const st = s?.type === "PARALLEL" ? s : undefined;
      for (const b of step.branches) {
        const bs = st?.branches.find((x) => x.branchKey === b.key);
        const state: State = bs?.status === "ACCEPTED" ? "done" : bs?.status === "REJECTED" ? "rejected"
          : isCurrent ? (request.status === "RETURNED" ? "returned" : "current") : "upcoming";
        const sub = bs?.decidedByName
          ? `${bs.status === "ACCEPTED" ? "Approved" : "Rejected"} by ${bs.decidedByName} · ${when(bs.decidedAt)}${bs.remarks ? ` - ${bs.remarks}` : ""}`
          : state === "current" ? "Waiting" : undefined;
        rows.push({ key: `${step.id}:${b.key}`, state, label: b.label, sub });
      }
    }
  });
  const issued = request.status === "ISSUED";
  rows.push({
    key: "issue", label: issued ? "Issued" : "Certificate issued",
    state: issued ? "done" : request.status === "PENDING_ISSUANCE" ? "current" : request.status === "REJECTED" && !request.steps.some((s) => s.type === "SEQUENTIAL" ? s.status === "REJECTED" : s.branches.some((b) => b.status === "REJECTED")) ? "rejected" : "upcoming",
    sub: issued ? `${request.certificateNumber ?? ""} · ${when(request.issuedAt)}` : request.status === "PENDING_ISSUANCE" ? "Approved - being prepared" : undefined,
  });
  return <ol className="space-y-2.5">{rows.map((r) => <Row key={r.key} state={r.state} label={r.label} sub={r.sub} />)}</ol>;
}

/** The student's answers, documents and purpose - what every approver checks. */
export function RequestAnswers({ request }: { request: CertificateRequest }) {
  const values = Object.entries(request.values ?? {});
  const labelOf = (k: string) => request.fields?.find((f) => f.key === k)?.label ?? k;
  if (!request.purpose && values.length === 0 && !(request.attachments ?? []).length) return null;
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
      {request.purpose && (<><dt className="text-muted-foreground">Purpose</dt><dd>{request.purpose}</dd></>)}
      {values.map(([k, v]) => (
        <Fragment key={k}><dt className="text-muted-foreground">{labelOf(k)}</dt><dd className="whitespace-pre-wrap break-words">{v}</dd></Fragment>
      ))}
      {(request.attachments ?? []).map((a) => (
        <Fragment key={`a-${a.key}`}><dt className="text-muted-foreground">{a.label}</dt><dd><a className="text-primary underline" href={a.url} target="_blank" rel="noopener noreferrer">View document</a></dd></Fragment>
      ))}
    </dl>
  );
}
