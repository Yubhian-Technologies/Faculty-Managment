"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CornerUpLeft, Eye, Pencil, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ResearchRecordDetails } from "@/components/research/ResearchRecordDetails";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RESEARCH_FIELD_LABELS } from "@/lib/research/fieldLabels";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import { useAuthStore } from "@/store/authStore";
import type { UserRole } from "@/types";

// The R&D Coordinator's review queue: every Research & Innovation submission
// from the department(s) they coordinate, across all modules. They verify it,
// correct it if needed, and either forward it to R&D, send it back to the
// faculty member to fix, or reject it. Scoping happens on the server
// (api/college/research-review) - this page just renders what comes back.

interface Item {
  module: string;
  moduleLabel: string;
  id: string;
  record: Record<string, unknown> & {
    status?: string; title?: string; ownerName?: string; ownerRole?: UserRole; ownerDesignation?: string;
    reviewDepartment?: string; sentBackReason?: string; rejectionReason?: string; coordinatorNote?: string;
  };
}
type Action = "FORWARD" | "SEND_BACK" | "REJECT" | "EDIT";

// Keys that are plumbing rather than something the submitter typed - never
// offered for editing (the server also refuses them).
const NOT_EDITABLE = new Set([
  "id", "uid", "collegeId", "status", "createdAt", "updatedAt", "addedBy", "addedByName", "ownerName", "ownerRole",
  "ownerDesignation", "reviewDepartment", "coordinatorUid", "reviewedBy", "reviewedByName", "reviewedAt", "rejectionReason",
  "changeLog", "coordinatorReviewedBy", "coordinatorReviewedByName", "coordinatorReviewedAt", "coordinatorNote",
  "sentBackReason", "coordinatorEdits", "internalAuthorUids",
]);

type Scalar = string | number | boolean | null;
const isScalar = (v: unknown): v is Scalar => v === null || ["string", "number", "boolean"].includes(typeof v);

// One level of nesting is enough for the records here (publications keep their
// form under `details`); deeper structures are shown read-only.
function editableFields(record: Record<string, unknown>): { path: string; value: Scalar }[] {
  const out: { path: string; value: Scalar }[] = [];
  for (const [k, v] of Object.entries(record)) {
    if (NOT_EDITABLE.has(k)) continue;
    if (isScalar(v)) out.push({ path: k, value: v });
    else if (v && typeof v === "object" && !Array.isArray(v) && !(typeof (v as { toDate?: unknown }).toDate === "function") && !("_seconds" in v)) {
      for (const [ik, iv] of Object.entries(v as Record<string, unknown>)) {
        if (isScalar(iv)) out.push({ path: `${k}.${ik}`, value: iv });
      }
    }
  }
  return out;
}

const humanize = (s: string) => s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const labelFor = (module: string, path: string) => {
  const key = path.split(".").pop() ?? path;
  return RESEARCH_FIELD_LABELS[module]?.[key] ?? humanize(key);
};

const STATUS_LABEL: Record<string, string> = {
  COORDINATOR_REVIEW: "To review", PENDING: "With R&D", APPROVED: "Approved", REJECTED: "Rejected", SENT_BACK: "Sent back",
};

export default function RndCoordinatorPage() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [tab, setTab] = useState<"review" | "done">("review");
  const [open, setOpen] = useState<Item | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reasonFor, setReasonFor] = useState<{ item: Item; action: "SEND_BACK" | "REJECT" } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["rnd-coordinator-queue"],
    queryFn: async () => {
      const res = await fetch("/api/college/research-review");
      const json = await res.json() as { departments?: string[]; items?: Item[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      return { departments: json.departments ?? [], items: json.items ?? [] };
    },
  });
  const departments = data?.departments ?? [];
  const items = useMemo(() => data?.items ?? [], [data]);
  const toReview = useMemo(() => items.filter((i) => i.record.status === "COORDINATOR_REVIEW"), [items]);
  const done = useMemo(() => items.filter((i) => i.record.status !== "COORDINATOR_REVIEW"), [items]);
  const shown = tab === "review" ? toReview : done;

  const fields = useMemo(() => (open ? editableFields(open.record) : []), [open]);

  function startReview(item: Item) {
    setOpen(item);
    setEditing(false);
    setDraft({});
  }

  async function send(item: Item, action: Action, extra?: { reason?: string; edits?: Record<string, unknown> }) {
    setBusy(true);
    try {
      const res = await fetch("/api/college/research-review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: item.module, id: item.id, action, ...extra }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed");
      await qc.invalidateQueries({ queryKey: ["rnd-coordinator-queue"] });
      return true;
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Draft values are strings; put each back in the type it had so the server's
  // same-type check accepts it.
  function collectEdits(): Record<string, unknown> {
    const edits: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = draft[f.path];
      if (raw === undefined) continue;
      if (typeof f.value === "number") {
        if (raw.trim() === "" || Number.isNaN(Number(raw))) continue;
        edits[f.path] = Number(raw);
      } else if (typeof f.value === "boolean") {
        edits[f.path] = raw === "true";
      } else {
        edits[f.path] = raw;
      }
    }
    return edits;
  }

  async function saveEdits() {
    if (!open) return;
    const edits = collectEdits();
    if (Object.keys(edits).length === 0) { toast({ title: "No changes to save" }); return; }
    if (await send(open, "EDIT", { edits })) {
      toast({ variant: "success", title: "Changes saved" });
      setOpen(null);
    }
  }

  async function forward() {
    if (!open) return;
    if (await send(open, "FORWARD", { edits: collectEdits() })) {
      toast({ variant: "success", title: "Forwarded to R&D" });
      setOpen(null);
    }
  }

  async function submitReason() {
    if (!reasonFor) return;
    if (await send(reasonFor.item, reasonFor.action, { reason: reason.trim() })) {
      toast({ variant: "success", title: reasonFor.action === "SEND_BACK" ? "Sent back to the submitter" : "Rejected" });
      setReasonFor(null); setReason(""); setOpen(null);
    }
  }

  const ownerLine = (i: Item) =>
    [i.record.ownerName, i.record.ownerDesignation ?? (i.record.ownerRole ? ROLE_LABELS[i.record.ownerRole] : undefined)].filter(Boolean).join(" · ");

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user?.name ?? "there"}`}
        description={departments.length > 0 ? `${ROLE_LABELS.RND_COORDINATOR} - ${departments.join(", ")}` : ROLE_LABELS.RND_COORDINATOR}
      />

      <div className="flex gap-2 border-b">
        {([["review", "To review", toReview.length], ["done", "Reviewed", 0]] as const).map(([key, label, count]) => (
          <button
            key={key} type="button" onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 ${tab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {label}
            {count > 0 && <Badge variant="destructive" className="text-xs">{count}</Badge>}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : departments.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">You aren&apos;t assigned as an R&amp;D Coordinator for any department.</CardContent></Card>
      ) : shown.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm font-medium">{tab === "review" ? "Nothing waiting for you" : "Nothing reviewed yet"}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {tab === "review" ? "Research submissions from your department show up here." : "Records you've forwarded, sent back or rejected show up here."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {shown.map((i) => (
            <Card key={`${i.module}:${i.id}`}>
              <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="text-xs font-normal">{i.moduleLabel}</Badge>
                    <Badge variant="outline" className="text-xs font-normal">{STATUS_LABEL[i.record.status ?? ""] ?? i.record.status}</Badge>
                  </div>
                  <p className="font-medium truncate">{i.record.title ?? "(untitled)"}</p>
                  <p className="text-xs text-muted-foreground">{ownerLine(i)}{i.record.reviewDepartment ? ` · ${i.record.reviewDepartment}` : ""}</p>
                </div>
                <Button variant={tab === "review" ? "default" : "outline"} size="sm" onClick={() => startReview(i)}>
                  <Eye className="h-4 w-4 mr-1" />{tab === "review" ? "Review" : "View"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{open?.moduleLabel}: {open?.record.title}</DialogTitle>
            <DialogDescription>{open ? ownerLine(open) : ""}</DialogDescription>
          </DialogHeader>

          {open && (open.record.sentBackReason || open.record.rejectionReason) && (
            <p className="text-xs rounded-md border p-2.5 text-muted-foreground">
              <span className="font-medium text-foreground/80">Reason:</span> {open.record.sentBackReason ?? open.record.rejectionReason}
            </p>
          )}

          {open && !editing && (
            <ResearchRecordDetails record={open.record} labels={RESEARCH_FIELD_LABELS[open.module]} />
          )}

          {open && editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.path} className="space-y-1">
                  <Label className="text-xs">{labelFor(open.module, f.path)}</Label>
                  {typeof f.value === "boolean" ? (
                    <select
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                      value={draft[f.path] ?? String(f.value)}
                      onChange={(e) => setDraft((d) => ({ ...d, [f.path]: e.target.value }))}
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : (
                    <Input
                      type={typeof f.value === "number" ? "number" : "text"}
                      value={draft[f.path] ?? (f.value === null ? "" : String(f.value))}
                      onChange={(e) => setDraft((d) => ({ ...d, [f.path]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {open?.record.status === "COORDINATOR_REVIEW" && (
            <DialogFooter className="flex-wrap gap-2 sm:justify-between">
              <div className="flex gap-2">
                {editing ? (
                  <>
                    <Button variant="outline" onClick={() => { setEditing(false); setDraft({}); }} disabled={busy}>Cancel edit</Button>
                    <Button variant="outline" onClick={() => void saveEdits()} loading={busy}>Save changes</Button>
                  </>
                ) : (
                  <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="h-4 w-4 mr-1" />Edit</Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => { setReasonFor({ item: open, action: "REJECT" }); setReason(""); }} disabled={busy}>
                  <X className="h-4 w-4 mr-1" />Reject
                </Button>
                <Button variant="outline" onClick={() => { setReasonFor({ item: open, action: "SEND_BACK" }); setReason(""); }} disabled={busy}>
                  <CornerUpLeft className="h-4 w-4 mr-1" />Send back
                </Button>
                <Button onClick={() => void forward()} loading={busy}>
                  <Check className="h-4 w-4 mr-1" />Accept &amp; forward to R&amp;D
                </Button>
              </div>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!reasonFor}
        onOpenChange={(o) => { if (!o) { setReasonFor(null); setReason(""); } }}
        title={reasonFor?.action === "REJECT" ? "Reject this submission?" : "Send back for changes?"}
        description={reasonFor?.action === "REJECT"
          ? `${reasonFor.item.record.ownerName} will be notified and can correct and resubmit it.`
          : `${reasonFor?.item.record.ownerName} will be notified and can edit and resubmit it to you.`}
        confirmLabel={reasonFor?.action === "REJECT" ? "Reject" : "Send back"}
        variant={reasonFor?.action === "REJECT" ? "destructive" : "default"}
        loading={busy}
        confirmDisabled={!reason.trim()}
        onConfirm={() => void submitReason()}
      >
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)..." rows={3} />
      </ConfirmDialog>
    </div>
  );
}
