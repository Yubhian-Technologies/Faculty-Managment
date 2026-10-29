"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  Inbox,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuthStore } from "@/store/authStore";
import { toast } from "@/hooks/useToast";
import {
  actOnRequest,
  listRequests,
  type ListView,
  type PermissionRequestView,
  type RequestAction,
} from "./api";
import {
  EmptyState,
  ListSkeleton,
  LoadError,
  formatPeriods,
  formatRange,
  stageLabel,
  StatusBadge,
} from "./statusBadge";

// A list of requests with the actions that make sense in that context:
//   mine       - withdraw while pending
//   inbox      - approve / reject what is waiting for me
//   oversight  - everything in my departments; revoke an approval, retry a failed attendance update

type Pending = {
  request: PermissionRequestView;
  action: RequestAction;
  needsRemark: boolean;
} | null;

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const HISTORY_VERB: Record<string, string> = {
  SUBMIT: "raised request",
  APPROVE: "approved",
  REJECT: "rejected",
  CANCEL: "withdrew request",
  REVOKE: "revoked approval",
  SKIP: "(skipped)",
  ESCALATE: "moved the request up (no answer in time)",
};

function Route({ request }: { request: PermissionRequestView }) {
  const skipped = new Set(
    request.history.filter((h) => h.action === "SKIP").map((h) => h.stage),
  );
  return (
    <ol
      className="flex flex-wrap items-center gap-1.5 text-xs"
      aria-label="Approval route"
    >
      {request.chain.map((stage, i) => {
        const done =
          request.status === "APPROVED" ||
          request.status === "REVOKED" ||
          i < request.stageIndex;
        const current =
          request.status === "PENDING" && i === request.stageIndex;
        const rejected =
          request.status === "REJECTED" && i === request.stageIndex;
        return (
          <li key={stage} className="flex items-center gap-1.5">
            {i > 0 && (
              <span className="text-muted-foreground" aria-hidden>
                →
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${
                rejected
                  ? "border-red-300 bg-red-50 text-red-800"
                  : current
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : done
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-transparent text-muted-foreground"
              }`}
            >
              {done && !skipped.has(stage) && (
                <Check className="h-3 w-3" aria-hidden />
              )}
              {stageLabel(stage)}
              {skipped.has(stage) ? " (skipped)" : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function RequestCard({
  request,
  view,
  viewerUid,
  overseer,
  onAct,
}: {
  request: PermissionRequestView;
  view: ListView;
  viewerUid: string;
  overseer: boolean;
  onAct: (p: NonNullable<Pending>) => void;
}) {
  const p = request.payload;
  const [open, setOpen] = useState(false);
  const mine = request.requesterUid === viewerUid;
  const displayCategory = p.otherCategory || p.categoryLabel;

  // A coloured left edge tells the state at a glance when scanning a long list on a phone.
  const edge =
    request.status === "APPROVED"
      ? "border-l-emerald-500"
      : request.status === "REJECTED"
        ? "border-l-red-500"
        : request.status === "PENDING"
          ? "border-l-amber-400"
          : "border-l-muted-foreground/30";

  return (
    <Card className={`overflow-hidden border border-l-4 shadow-xs ${edge}`}>
      <CardContent className="p-3 sm:p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold break-words text-sm sm:text-base">
              {p.title}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="font-medium text-foreground/80">
                {displayCategory}
              </span>
              <span className="mx-1.5" aria-hidden>
                ·
              </span>
              {formatRange(p.fromDate, p.toDate)}
              <span className="mx-1.5" aria-hidden>
                ·
              </span>
              {formatPeriods(p.periods)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0">
            {p.late && (
              <Badge
                variant="outline"
                className="border-amber-300 text-amber-800 text-xs rounded-md"
                title="Raised with less than the preferred notice"
              >
                <AlertTriangle className="h-3 w-3 mr-1" aria-hidden />
                Short notice
              </Badge>
            )}
            <StatusBadge request={request} />
          </div>
        </div>

        <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
          {p.description}
        </p>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2 sm:text-sm">
          <div className="flex min-w-0 gap-1.5">
            <dt className="shrink-0 text-muted-foreground">
              {request.requesterType === "FACULTY" ? "Raised by" : "Student"}
            </dt>
            <dd className="min-w-0 break-words font-medium text-foreground">
              {request.requesterName}
              {request.requesterType === "FACULTY" && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  for {p.students.length} student
                  {p.students.length === 1 ? "" : "s"}
                </span>
              )}
            </dd>
          </div>
          <div className="flex min-w-0 gap-1.5">
            <dt className="shrink-0 text-muted-foreground">Dept</dt>
            <dd className="min-w-0 break-words">{request.scope}</dd>
          </div>
          {p.students.length === 1 && (
            <div className="flex min-w-0 gap-1.5">
              <dt className="shrink-0 text-muted-foreground">Class</dt>
              <dd className="font-medium text-foreground">
                Year {p.students[0].year}, Section {p.students[0].section}
              </dd>
            </div>
          )}
          {p.venue && (
            <div className="flex min-w-0 gap-1.5">
              <dt className="shrink-0 text-muted-foreground">Venue</dt>
              <dd className="min-w-0 break-words">{p.venue}</dd>
            </div>
          )}
        </dl>

        {p.students.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {p.students.slice(0, open ? undefined : 6).map((s) => (
              <Badge
                key={s.id}
                variant="secondary"
                className="h-auto max-w-full whitespace-normal break-words py-0.5 text-left text-xs font-normal rounded-md"
              >
                {s.rollNumber} · {s.name}{" "}
                <span className="text-muted-foreground ml-1">
                  (Yr {s.year} - Sec {s.section})
                </span>
              </Badge>
            ))}
            {!open && p.students.length > 6 && (
              <button
                type="button"
                className="inline-flex min-h-8 items-center rounded px-1.5 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setOpen(true)}
                aria-expanded={open}
              >
                +{p.students.length - 6} more
              </button>
            )}
          </div>
        )}

        <Route request={request} />

        {request.status === "PENDING" && request.escalateAt && (
          <p className="text-xs text-muted-foreground">
            Waiting for {stageLabel(request.chain[request.stageIndex])}. If nobody decides by{" "}
            <span className="font-medium text-foreground">{when(request.escalateAt)}</span> it moves up to{" "}
            {stageLabel(request.chain[request.stageIndex + 1])}.
          </p>
        )}

        {p.proof.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs sm:text-sm">
            {p.proof.map((f) => (
              <a
                key={f.url}
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-9 max-w-full items-center gap-1 rounded text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-7"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{f.name}</span>
              </a>
            ))}
          </div>
        )}

        {request.effectStatus === "FAILED" && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800"
            role="alert"
          >
            <span className="flex-1">
              Approved, but the attendance update did not complete. Covered
              periods remain marked On Duty.
            </span>
            {view !== "mine" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() =>
                  onAct({ request, action: "RETRY", needsRemark: false })
                }
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1" aria-hidden />
                Retry
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 border-t pt-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
              aria-hidden
            />
            History{" "}
            {request.history.length > 0 && `(${request.history.length})`}
          </button>
          {/* On a phone the actions fill the row (Approve beside Reject), so each is an easy thumb target. */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end [&>button]:min-h-10 sm:[&>button]:min-h-8">
            {mine && request.status === "PENDING" && (
              <Button
                size="sm"
                variant="outline"
                className="col-span-2"
                onClick={() =>
                  onAct({ request, action: "CANCEL", needsRemark: false })
                }
              >
                Withdraw
              </Button>
            )}
            {view === "oversight" && request.status === "PENDING" && !mine && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onAct({ request, action: "CANCEL", needsRemark: true })}
              >
                Withdraw
              </Button>
            )}
            {(view === "inbox" || (view === "oversight" && overseer)) &&
              request.status === "PENDING" &&
              !mine && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    onClick={() =>
                      onAct({ request, action: "REJECT", needsRemark: true })
                    }
                  >
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      onAct({ request, action: "APPROVE", needsRemark: false })
                    }
                  >
                    Approve
                  </Button>
                </>
              )}
            {view === "oversight" && request.status === "APPROVED" && !mine && request.payload.fromDate >= todayIST() && (
              <Button
                size="sm"
                variant="outline"
                className="col-span-2"
                onClick={() =>
                  onAct({ request, action: "REVOKE", needsRemark: true })
                }
              >
                Revoke
              </Button>
            )}
          </div>
        </div>

        {open && (
          <ol
            className="space-y-1.5 border-t pt-2 text-xs text-muted-foreground"
            aria-label="Request history"
          >
            {request.history.length === 0 && <li>No history recorded yet.</li>}
            {request.history.map((h, i) => (
              <li key={i}>
                <span className="text-foreground font-medium">
                  {h.actorName}
                </span>{" "}
                {HISTORY_VERB[h.action] ?? h.action}
                {h.stage ? ` as ${stageLabel(h.stage)}` : ""} · {when(h.at)}
                {h.remark ? ` — "${h.remark}"` : ""}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

const COPY: Record<
  RequestAction,
  {
    title: string;
    confirm: string;
    done: string;
    remarkLabel: string;
    warning?: string;
  }
> = {
  APPROVE: {
    title: "Approve this request?",
    confirm: "Approve",
    done: "Approved",
    remarkLabel: "Note (optional)",
  },
  REJECT: {
    title: "Reject this request?",
    confirm: "Reject",
    done: "Rejected",
    remarkLabel: "Reason (required)",
    warning: "The requester will be notified with your reason.",
  },
  CANCEL: {
    title: "Withdraw this request?",
    confirm: "Withdraw",
    done: "Request withdrawn",
    remarkLabel: "Note (optional)",
    warning: "If this is not your own request, the student is told it was withdrawn and why.",
  },
  REVOKE: {
    title: "Revoke this approval?",
    confirm: "Revoke",
    done: "Approval revoked - attendance restored",
    remarkLabel: "Reason (required)",
    warning:
      "Revoking restores the original attendance marks and lifts the coverage.",
  },
  RETRY: {
    title: "Retry the attendance update?",
    confirm: "Retry",
    done: "Attendance updated",
    remarkLabel: "",
  },
};

function StatusFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const OPTIONS: { value: string; label: string }[] = [
    { value: "", label: "All statuses" },
    { value: "PENDING", label: "Pending" },
    { value: "APPROVED", label: "Approved" },
    { value: "REJECTED", label: "Rejected" },
    { value: "CANCELLED", label: "Withdrawn" },
    { value: "REVOKED", label: "Revoked" },
  ];
  return (
    <select
      aria-label="Filter by status"
      className="h-11 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:w-auto"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function RequestList({
  view,
  empty,
  emptyHint,
}: {
  view: ListView;
  empty: string;
  emptyHint?: string;
}) {
  const viewerUid = useAuthStore((s) => s.user?.uid) ?? "";
  // Principal / Vice Principal decide any department's request (server: canDecideStage).
  const overseer = useAuthStore((s) =>
    (s.user?.roles ?? [s.user?.role]).some(
      (r) => r === "PRINCIPAL" || r === "VICE_PRINCIPAL",
    ),
  );
  const [dept, setDept] = useState("");
  const [status, setStatus] = useState("");
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["student-permissions", view],
    queryFn: () => listRequests(view),
    staleTime: 15_000,
  });
  const [pending, setPending] = useState<Pending>(null);
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!pending) return;
    if (pending.needsRemark && !remark.trim()) {
      toast({ variant: "destructive", title: "Please add a reason" });
      return;
    }
    setBusy(true);
    try {
      await actOnRequest(
        pending.request.id,
        pending.action,
        remark.trim() || undefined,
      );
      toast({ variant: "success", title: COPY[pending.action].done });
      setPending(null);
      setRemark("");
      await qc.invalidateQueries({ queryKey: ["student-permissions"] });
    } catch (e) {
      toast({
        variant: "destructive",
        title: e instanceof Error ? e.message : "That didn't work",
      });
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <ListSkeleton rows={4} />;
  if (isError)
    return (
      <LoadError
        message={error instanceof Error ? error.message : undefined}
        onRetry={() => void refetch()}
      />
    );
  if (!data?.length)
    return <EmptyState icon={Inbox} headline={empty} hint={emptyHint} />;

  const copy = pending ? COPY[pending.action] : null;
  const depts = Array.from(new Set(data.map((r) => r.scope))).sort();
  const shown = data.filter(
    (r) => (!dept || r.scope === dept) && (!status || r.status === status),
  );

  return (
    <>
      <div className="mb-3 grid grid-cols-1 items-center gap-2 sm:flex sm:flex-wrap">
        {depts.length > 1 && (
          <select
            aria-label="Filter by department"
            className="h-11 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:w-auto"
            value={dept}
            onChange={(e) => setDept(e.target.value)}
          >
            <option value="">All departments</option>
            {depts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
        <StatusFilter value={status} onChange={setStatus} />
        <span className="text-xs text-muted-foreground sm:ml-auto" role="status">
          {shown.length} of {data.length} request{data.length === 1 ? "" : "s"}
        </span>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={Inbox}
          headline="No requests match these filters."
          hint="Clear the department or status filter to see more."
        />
      ) : (
        <div className="space-y-3">
          {shown.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              view={view}
              viewerUid={viewerUid}
              overseer={overseer}
              onAct={(p) => {
                setRemark("");
                setPending(p);
              }}
            />
          ))}
        </div>
      )}

      <Dialog
        open={!!pending}
        onOpenChange={(o) => {
          if (!o) setPending(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy?.title}</DialogTitle>
            <DialogDescription>
              {pending?.request.payload.title} ·{" "}
              {pending?.request.requesterName}
            </DialogDescription>
          </DialogHeader>
          {copy?.remarkLabel ? (
            <div className="space-y-1.5">
              <Label htmlFor="act-remark">
                {pending?.needsRemark && pending.action === "CANCEL" ? "Reason (required)" : copy.remarkLabel}
                {pending?.needsRemark && (
                  <span className="text-destructive ml-1" aria-hidden>
                    *
                  </span>
                )}
              </Label>
              <Textarea
                id="act-remark"
                rows={3}
                maxLength={500}
                value={remark}
                autoFocus
                onChange={(e) => setRemark(e.target.value)}
                placeholder={
                  pending?.needsRemark
                    ? "Required for this action"
                    : "Optional note"
                }
                aria-required={pending?.needsRemark}
              />
              {copy.warning && (
                <p className="text-xs text-muted-foreground">{copy.warning}</p>
              )}
            </div>
          ) : (
            copy?.warning && (
              <p className="text-xs text-muted-foreground">{copy.warning}</p>
            )
          )}
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row [&>button]:min-h-11 sm:[&>button]:min-h-9">
            <Button
              variant="outline"
              onClick={() => setPending(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant={
                pending?.action === "REJECT" || pending?.action === "REVOKE"
                  ? "destructive"
                  : "default"
              }
              loading={busy}
              disabled={busy && !!pending?.needsRemark && !remark.trim()}
              onClick={() => void confirm()}
            >
              {copy?.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
