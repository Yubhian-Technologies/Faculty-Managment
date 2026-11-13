"use client";

import { useEffect, useMemo, useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { toRoman } from "@/lib/academic/format";
import { loadBatchOptions, resetType, startBatch, type BatchGroupRow, type BatchOptions } from "./configApi";
import { useAuth } from "@/hooks/useAuth";

// The College Office starts a certificate it starts (No Dues) for whole classes: pick the certificate, tick the
// classes (branch / year / section, studying or passed out), see who will be started and who is skipped, start.

const STATUS_LABEL: Record<string, string> = { REGULAR: "Studying", DETAINED: "Detained", GRADUATED: "Passed out", DISCONTINUED: "Discontinued" };

export function BatchStart({ onStarted }: { onStarted: () => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<BatchOptions | null>(null);
  const { user } = useAuth();
  // Switching the No Dues to the new form is a Setup change - Principal / College Admin / VP only.
  const canSetup = [user?.role, ...(user?.roles ?? [])].some((r) => r === "PRINCIPAL" || r === "VICE_PRINCIPAL");
  const [typeId, setTypeId] = useState("");
  const [status, setStatus] = useState("GRADUATED");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [check, setCheck] = useState<{ started: number; skipped: { student: string; reason: string }[]; total: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || data) return;
    loadBatchOptions().then((d) => { setData(d); setTypeId(d.types.find((t) => t.isActive)?.id ?? ""); })
      .catch((e) => toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to load classes" }));
  }, [open, data]);

  const groups = useMemo(() => (data?.groups ?? []).filter((g) => g.status === status), [data, status]);
  const byBranch = useMemo(() => {
    const m = new Map<string, BatchGroupRow[]>();
    for (const g of groups) m.set(g.department, [...(m.get(g.department) ?? []), g]);
    return [...m];
  }, [groups]);
  const toggle = (keys: string[], on: boolean) => { setCheck(null); setPicked((p) => { const n = new Set(p); keys.forEach((k) => (on ? n.add(k) : n.delete(k))); return n; }); };
  const count = groups.filter((g) => picked.has(g.key)).reduce((s, g) => s + g.count, 0);

  async function upgrade() {
    if (!data?.oldNoDues) return;
    setBusy(true);
    try {
      await resetType(data.oldNoDues.id);
      toast({ variant: "success", title: "No Dues switched to the new form - review its departments in Setup" });
      setData(null);
      const d = await loadBatchOptions();
      setData(d);
      setTypeId(d.types.find((t) => t.isActive)?.id ?? "");
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to switch it" });
    } finally { setBusy(false); }
  }

  async function run(dryRun: boolean) {
    setBusy(true);
    try {
      const r = await startBatch(typeId, [...picked], dryRun);
      if (dryRun) setCheck(r);
      else {
        toast({ variant: "success", title: `Started for ${r.started} student${r.started === 1 ? "" : "s"}${r.skipped.length ? ` (${r.skipped.length} skipped)` : ""}` });
        setOpen(false); setPicked(new Set()); setCheck(null); onStarted();
      }
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to start" });
    } finally { setBusy(false); }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}><Play className="h-4 w-4 mr-1" /> Start for classes</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Start a certificate for classes</DialogTitle>
            <DialogDescription>Each department on the list receives the students in its inbox; students follow the progress under Certificates.</DialogDescription>
          </DialogHeader>
          {data?.oldNoDues && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm space-y-2 dark:border-amber-900 dark:bg-amber-950/40">
              <p>Your <b>{data.oldNoDues.name}</b> is the earlier version (students apply). The new one is started here by the College Office, with every department line - dues, approval, Exam Cell Pass / Fail - and the clearance table.</p>
              {data.oldNoDues.inUse ? (
                <p className="text-muted-foreground">Requests already use it, so it cannot be replaced. In Setup, edit it and set Who Starts It to the College Office and the departments as needed.</p>
              ) : canSetup ? (
                <Button size="sm" loading={busy} onClick={upgrade}>Switch to the new No Dues</Button>
              ) : (
                <p className="text-muted-foreground">Ask the Principal / College Admin to switch it in Setup (No Dues → Reset).</p>
              )}
            </div>
          )}
          {!data ? <p className="text-sm text-muted-foreground">Loading…</p> : data.types.length === 0 ? (
            !data.oldNoDues && <p className="text-sm text-muted-foreground">No certificate is set to be started by the College Office. In Setup, edit a certificate and set Who Starts It to the College Office.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>Certificate</Label>
                  <Select value={typeId || undefined} onValueChange={(v) => { setTypeId(v); setCheck(null); }}>
                    <SelectTrigger><SelectValue placeholder="Pick" /></SelectTrigger>
                    <SelectContent>{data.types.map((t) => <SelectItem key={t.id} value={t.id} disabled={!t.isActive}>{t.name}{t.isActive ? "" : " (switched off)"}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Students</Label>
                  <Select value={status} onValueChange={(v) => { setStatus(v); setPicked(new Set()); setCheck(null); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              {byBranch.length === 0 ? <p className="text-sm text-muted-foreground">No {STATUS_LABEL[status].toLowerCase()} students.</p> : (
                <div className="space-y-3">
                  {byBranch.map(([branch, rows]) => {
                    const all = rows.every((g) => picked.has(g.key));
                    return (
                      <div key={branch} className="rounded-md border p-2.5">
                        <label className="flex items-center gap-2 text-sm font-medium">
                          <Checkbox checked={all} onCheckedChange={(c) => toggle(rows.map((g) => g.key), c === true)} /> {branch || "No branch"}
                        </label>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 pl-6">
                          {rows.map((g) => (
                            <label key={g.key} className="flex items-center gap-1.5 text-sm">
                              <Checkbox checked={picked.has(g.key)} onCheckedChange={(c) => toggle([g.key], c === true)} />
                              {g.year ? `${toRoman(g.year)} year` : "No year"} {g.section || ""} <span className="text-muted-foreground">({g.count})</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {check && (
                <div className="rounded-md bg-muted/60 px-3 py-2 text-sm space-y-1">
                  <p><b>{check.started}</b> of {check.total} students will be started.</p>
                  {check.skipped.length > 0 && (
                    <details><summary className="cursor-pointer">{check.skipped.length} skipped</summary>
                      <ul className="mt-1 max-h-40 overflow-y-auto text-xs text-muted-foreground">{check.skipped.map((s, i) => <li key={i}>{s.student} - {s.reason}</li>)}</ul>
                    </details>
                  )}
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" disabled={!typeId || picked.size === 0} loading={busy && !check} onClick={() => run(true)}>Check {count ? `(${count})` : ""}</Button>
                <Button disabled={!check || check.started === 0} loading={busy && !!check} onClick={() => run(false)}>Start for {check?.started ?? 0}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
