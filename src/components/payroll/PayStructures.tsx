"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { History, Pencil, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { exemptableDeductions } from "@/lib/payroll/pay";
import type { PayRevision, PayrollSettings } from "@/types/payroll";
import { PayImportDialog } from "./PayImportDialog";
import { collegeQs, monthLabel, payrollFetch, rupees, selectClass, thisMonth } from "./payrollClient";

// Pay structures: every faculty / staff member with the pay in force for a month - each part's fixed
// monthly amount, Gross_Actual (their sum) and the deductions that don't apply to them. Accounts edit
// (a new revision from a month) and import their salary sheet; the College Office only reads.

export interface PayRow {
  employeeKey: string; kind: "FACULTY" | "STAFF"; employeeCode: string; name: string; department: string; designation: string;
  status: string; section: "TEACHING" | "NON_TEACHING"; joiningDate?: string;
  hasPay: boolean; effectiveFrom: string | null; amounts: Record<string, number>; exempt: string[]; grossActual: number;
  revisionCount: number; upcoming: string[];
}

const EXITED = new Set(["RESIGNED", "RETIRED"]);

export function PayStructures({ collegeId }: { collegeId?: string }) {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<{ settings: PayrollSettings; rows: PayRow[]; canEdit: boolean } | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [section, setSection] = useState("");
  const [only, setOnly] = useState<"" | "MISSING" | "HAS">("");
  const [editing, setEditing] = useState<PayRow | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => {
    payrollFetch<{ settings: PayrollSettings; rows: PayRow[]; canEdit: boolean }>(`/api/college/payroll/pay${collegeQs(collegeId, { month })}`)
      .then((d) => { setData(d); setError(""); }).catch((e: Error) => setError(e.message));
  }, [collegeId, month]);
  useEffect(load, [load]);

  const earnings = useMemo(() => data?.settings.earnings.filter((e) => e.active || data.rows.some((r) => r.amounts[e.id])) ?? [], [data]);
  const dedLabel = useMemo(() => new Map((data?.settings.deductions ?? []).map((d) => [d.id, d.label])), [data]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) =>
      (!section || r.section === section) && (!only || (only === "HAS") === r.hasPay) &&
      (!s || `${r.employeeCode} ${r.name} ${r.department} ${r.designation}`.toLowerCase().includes(s)));
  }, [data, q, section, only]);
  const active = (data?.rows ?? []).filter((r) => !EXITED.has(r.status));
  const missing = active.filter((r) => !r.hasPay).length;
  const total = rows.reduce((a, r) => a + r.grossActual, 0);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <div className="h-40 animate-pulse rounded-2xl bg-muted/40" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5"><Label htmlFor="ps-month">Pay in force for</Label><Input id="ps-month" type="month" className="w-40" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></div>
        <div className="relative min-w-[14rem] flex-1 space-y-1.5"><Label htmlFor="ps-q">Search</Label>
          <Search className="pointer-events-none absolute left-2.5 top-[2.1rem] h-4 w-4 text-muted-foreground" />
          <Input id="ps-q" className="pl-8" placeholder="Emp Code, name, department" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="space-y-1.5"><Label htmlFor="ps-sec">Section</Label>
          <select id="ps-sec" className={selectClass} value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">All</option><option value="TEACHING">Teaching</option><option value="NON_TEACHING">Non-teaching</option>
          </select>
        </div>
        <div className="space-y-1.5"><Label htmlFor="ps-only">Show</Label>
          <select id="ps-only" className={selectClass} value={only} onChange={(e) => setOnly(e.target.value as typeof only)}>
            <option value="">Everyone</option><option value="MISSING">No pay set</option><option value="HAS">Pay set</option>
          </select>
        </div>
        {data.canEdit && <Button variant="outline" onClick={() => setImporting(true)}><Upload className="mr-1.5 h-4 w-4" />Import salary sheet</Button>}
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <span className="rounded-full bg-muted px-3 py-1">{active.length - missing} of {active.length} working people have pay set</span>
        {missing > 0 && <button type="button" onClick={() => setOnly("MISSING")} className="rounded-full bg-amber-100 px-3 py-1 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">{missing} without pay</button>}
        <span className="rounded-full bg-muted px-3 py-1">Gross_Actual of the list: Rs. {rupees(total)}</span>
      </div>

      <Card className="rounded-2xl"><CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Emp Code</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Dept</th><th className="px-3 py-2">From</th>
              {earnings.map((e) => <th key={e.id} className="px-3 py-2 text-right">{e.label}</th>)}
              <th className="px-3 py-2 text-right">Gross_Actual</th><th className="px-3 py-2">Not applied</th><th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employeeKey} className="border-t">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.employeeCode || "-"}</td>
                <td className="px-3 py-2"><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.designation}{EXITED.has(r.status) ? ` · ${r.status.toLowerCase()}` : ""}</div></td>
                <td className="px-3 py-2">{r.department || "-"}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.effectiveFrom ? monthLabel(r.effectiveFrom) : <span className="text-amber-700 dark:text-amber-300">Not set</span>}{r.upcoming.length > 0 && <div className="text-xs text-muted-foreground">change from {monthLabel(r.upcoming[0])}</div>}</td>
                {earnings.map((e) => <td key={e.id} className="px-3 py-2 text-right tabular-nums">{r.amounts[e.id] ? rupees(r.amounts[e.id]) : ""}</td>)}
                <td className="px-3 py-2 text-right font-medium tabular-nums">{r.hasPay ? rupees(r.grossActual) : ""}</td>
                <td className="px-3 py-2 text-xs">{r.exempt.map((id) => dedLabel.get(id) ?? id).join(", ")}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>{data.canEdit ? <><Pencil className="mr-1 h-3.5 w-3.5" />Edit</> : <><History className="mr-1 h-3.5 w-3.5" />History</>}</Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={earnings.length + 7} className="px-3 py-8 text-center text-muted-foreground">Nobody matches.</td></tr>}
          </tbody>
        </table>
      </CardContent></Card>

      {editing && <PayEditDialog collegeId={collegeId} row={editing} settings={data.settings} canEdit={data.canEdit} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {importing && <PayImportDialog collegeId={collegeId} settings={data.settings} rows={data.rows} onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); }} />}
    </div>
  );
}

function PayEditDialog({ collegeId, row, settings, canEdit, onClose, onSaved }: {
  collegeId?: string; row: PayRow; settings: PayrollSettings; canEdit: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [revisions, setRevisions] = useState<PayRevision[] | null>(null);
  const [from, setFrom] = useState(thisMonth());
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(row.amounts).map(([k, v]) => [k, String(v)])));
  const [exempt, setExempt] = useState<string[]>(row.exempt);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const url = `/api/college/payroll/pay/${encodeURIComponent(row.employeeKey)}${collegeQs(collegeId)}`;
  useEffect(() => {
    payrollFetch<{ revisions: PayRevision[] }>(url).then((d) => setRevisions(d.revisions)).catch(() => setRevisions([]));
  }, [url]);

  const parts = settings.earnings.filter((e) => e.active || row.amounts[e.id]);
  const total = parts.reduce((a, e) => a + (Number(amounts[e.id]) || 0), 0);
  const dedLabel = new Map(settings.deductions.map((d) => [d.id, d.label]));

  async function save() {
    if (revisions === null) return;
    setBusy(true);
    try {
      await payrollFetch(url, { method: "PUT", body: JSON.stringify({ revisionCount: revisions.length, revision: { effectiveFrom: from, amounts: Object.fromEntries(parts.map((e) => [e.id, amounts[e.id] ? Number(amounts[e.id]) : 0])), exempt, note } }) });
      toast({ variant: "success", title: `Pay saved from ${monthLabel(from)}` });
      onSaved();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to save" }); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row.name}</DialogTitle>
          <DialogDescription>{row.employeeCode || "No Emp Code"} · {row.designation}{row.department ? ` · ${row.department}` : ""}</DialogDescription>
        </DialogHeader>
        {canEdit && (
          <div className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="pe-from">New pay starts from</Label>
              <Input id="pe-from" type="month" className="w-44" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
              <p className="text-xs text-muted-foreground">Applies from the 1st of that month. A released month cannot be changed; pay a back-dated increase as arrears.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {parts.map((e) => (
                <div key={e.id} className="space-y-1"><Label htmlFor={`pe-${e.id}`}>{e.label}{!e.active ? " (retired)" : ""}</Label>
                  <Input id={`pe-${e.id}`} inputMode="numeric" disabled={!e.active} value={amounts[e.id] ?? ""} onChange={(ev) => setAmounts({ ...amounts, [e.id]: ev.target.value.replace(/[^\d]/g, "") })} />
                </div>
              ))}
            </div>
            <p className="text-sm">Gross_Actual: <span className="font-semibold tabular-nums">Rs. {rupees(total)}</span></p>
            <div className="space-y-2"><p className="text-sm font-medium">Deductions that apply</p>
              <div className="flex flex-wrap gap-4">
                {exemptableDeductions(settings).filter((d) => d.active).map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={!exempt.includes(d.id)} onCheckedChange={(c) => setExempt((x) => (c ? x.filter((i) => i !== d.id) : [...x, d.id]))} />{d.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1"><Label htmlFor="pe-note">Note (optional)</Label><Textarea id="pe-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Annual increment" /></div>
          </div>
        )}
        <div className="space-y-2">
          <p className="text-sm font-medium">History</p>
          {revisions === null ? <div className="h-16 animate-pulse rounded bg-muted/40" /> : revisions.length === 0 ? <p className="text-sm text-muted-foreground">No pay saved yet.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead className="text-left text-muted-foreground"><tr><th className="py-1 pr-2">From</th><th className="py-1 pr-2">Pay</th><th className="py-1 pr-2 text-right">Gross</th><th className="py-1 pr-2">Not applied</th><th className="py-1">By</th></tr></thead>
              <tbody>{[...revisions].reverse().map((r) => (
                <tr key={r.effectiveFrom} className="border-t align-top">
                  <td className="py-1 pr-2 whitespace-nowrap">{monthLabel(r.effectiveFrom)}</td>
                  <td className="py-1 pr-2">{settings.earnings.filter((e) => r.amounts[e.id]).map((e) => `${e.label} ${rupees(r.amounts[e.id])}`).join(" · ")}{r.note ? <div className="text-muted-foreground">{r.note}</div> : null}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{rupees(Object.values(r.amounts).reduce((a, v) => a + v, 0))}</td>
                  <td className="py-1 pr-2">{r.exempt.map((id) => dedLabel.get(id) ?? id).join(", ")}</td>
                  <td className="py-1">{r.byName}<div className="text-muted-foreground">{new Date(r.at).toLocaleDateString("en-IN")}</div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {canEdit && <Button onClick={save} disabled={busy || revisions === null || total <= 0}>{busy ? "Saving..." : "Save pay"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
