"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { dmy } from "@/lib/utils";
import type { FeeHead, FeeStructure } from "@/types/fees";
import { feeGet, feeSend, rupee, selectClass, yearChoices, type FeeOptions } from "./feeApi";

// Accounts > Fees > Fee Structures: each academic year's fee per course + batch + category - A (Convenor students,
// FR or NFR, and Spot students) or B (Management) - by fee head; for Category A, which heads FR covers (the government
// pays them for FR students). Split into instalments with due dates. A draft can change freely;
// a published one needs a reason (accounts already raised keep their fee until fees are raised again).

interface Props { collegeId: string; options: FeeOptions; academicYear: string; setAcademicYear: (y: string) => void }
const CAT = { A: "Category A", B: "Category B" } as const;

export function FeeStructures({ collegeId, options, academicYear, setAcademicYear }: Props) {
  const [heads, setHeads] = useState<FeeHead[] | null>(null);
  const [structures, setStructures] = useState<FeeStructure[] | null>(null);
  const [editing, setEditing] = useState<Partial<FeeStructure> | null>(null);
  const [tick, setTick] = useState(0);
  const load = () => setTick((n) => n + 1);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [h, s] = await Promise.all([
          feeGet<{ heads: FeeHead[] }>("/api/college/fees/heads", collegeId),
          feeGet<{ structures: FeeStructure[] }>(`/api/college/fees/structures?academicYear=${academicYear}`, collegeId),
        ]);
        if (live) { setHeads(h.heads); setStructures(s.structures); }
      } catch (e) { if (live) toast({ variant: "destructive", title: (e as Error).message }); }
    })();
    return () => { live = false; };
  }, [collegeId, academicYear, tick]);

  async function remove(s: FeeStructure) {
    try { await feeSend(`/api/college/fees/structures?id=${s.id}`, collegeId, "DELETE"); toast({ title: "Draft deleted." }); load(); }
    catch (e) { toast({ variant: "destructive", title: (e as Error).message }); }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3 space-y-0">
        <div><CardTitle className="text-base">Fee Structures</CardTitle><CardDescription>The year&apos;s fee per course, batch and category. Spot students take the Category A fee and always pay it themselves.</CardDescription></div>
        <div className="flex items-end gap-2">
          <div className="w-32 space-y-1"><Label className="text-xs">Academic Year</Label>
            <select className={selectClass} value={academicYear} onChange={(e) => setAcademicYear(e.target.value)}>{yearChoices(options.academicYear).map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </div>
          <Button size="sm" disabled={!heads?.some((h) => h.active)} onClick={() => setEditing({ academicYear, category: "A", heads: [], instalments: [] })}><Plus className="mr-1 h-4 w-4" />Add Structure</Button>
        </div>
      </CardHeader>
      <CardContent>
        {heads?.length === 0 && <p className="mb-3 text-sm text-muted-foreground">Add the bank accounts and fee heads on Setup first.</p>}
        {structures === null ? <div className="h-24 animate-pulse rounded bg-muted" /> : structures.length === 0 ? <p className="text-sm text-muted-foreground">No fee structures for {academicYear} yet.</p> : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr>{["Course", "Batch", "Category", "Fee", "FR Covers", "Instalments", "Status", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {structures.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2">{s.courseName}</td>
                    <td className="px-3 py-2">{s.batch}</td>
                    <td className="px-3 py-2">{CAT[s.category]}</td>
                    <td className="px-3 py-2 font-medium tabular-nums">{rupee(s.total)}</td>
                    <td className="px-3 py-2 text-xs">{s.category === "A" ? (s.heads.filter((h) => h.frCovered).map((h) => h.name).join(", ") || <span className="text-muted-foreground">None</span>) : <span className="text-muted-foreground">-</span>}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{s.instalments.map((x) => `${x.percent}% by ${dmy(x.dueDate)}`).join(" · ")}</td>
                    <td className="px-3 py-2"><Badge variant={s.status === "PUBLISHED" ? "approved" : "outline"}>{s.status === "PUBLISHED" ? "Published" : "Draft"}</Badge></td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => setEditing(s)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" aria-label="Copy" title="Copy to another batch / category / year" onClick={() => { const c: Partial<FeeStructure> = { ...s }; delete c.id; delete c.status; delete c.rev; setEditing(c); }}><Copy className="h-4 w-4" /></Button>
                        {s.status === "DRAFT" && <Button size="icon" variant="ghost" aria-label="Delete draft" onClick={() => void remove(s)}><Trash2 className="h-4 w-4" /></Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {editing && heads && <StructureDialog collegeId={collegeId} options={options} heads={heads} initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </Card>
  );
}

interface InstDraft { label: string; dueDate: string; percent: string }

function StructureDialog({ collegeId, options, heads, initial, onClose, onSaved }: { collegeId: string; options: FeeOptions; heads: FeeHead[]; initial: Partial<FeeStructure>; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!initial.id;
  const published = initial.status === "PUBLISHED";
  const [academicYear, setYear] = useState(initial.academicYear ?? options.academicYear);
  const [courseKey, setCourseKey] = useState(initial.courseKey ?? options.courses[0]?.key ?? "");
  const [batch, setBatch] = useState(initial.batch ?? "");
  const [category, setCategory] = useState<"A" | "B">(initial.category ?? "A");
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries((initial.heads ?? []).map((h) => [h.headId, String(h.amount)])));
  const [fr, setFr] = useState<Record<string, boolean>>(() => Object.fromEntries((initial.heads ?? []).map((h) => [h.headId, !!h.frCovered])));
  const [inst, setInst] = useState<InstDraft[]>(() => (initial.instalments?.length ? initial.instalments.map((x) => ({ label: x.label, dueDate: x.dueDate, percent: String(x.percent) })) : [{ label: "First Instalment", dueDate: "", percent: "100" }]));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const total = useMemo(() => Object.values(amounts).reduce((n, v) => n + (Number(v) || 0), 0), [amounts]);
  const frTotal = heads.reduce((n, h) => n + (fr[h.id] ? Number(amounts[h.id]) || 0 : 0), 0);
  const pct = Math.round(inst.reduce((n, x) => n + (Number(x.percent) || 0), 0) * 100) / 100;
  const batches = options.batchesByCourse[courseKey] ?? [];
  const shown = heads.filter((h) => h.active || amounts[h.id]);

  async function save(publish: boolean) {
    setSaving(true);
    try {
      await feeSend("/api/college/fees/structures", collegeId, "POST", {
        ...(isEdit ? { id: initial.id, rev: initial.rev } : {}), academicYear, courseKey, courseName: options.courses.find((c) => c.key === courseKey)?.name ?? "", batch, category,
        heads: Object.entries(amounts).map(([headId, v]) => ({ headId, amount: Number(v) || 0, frCovered: category === "A" && !!fr[headId] })),
        instalments: inst.map((x) => ({ label: x.label, dueDate: x.dueDate, percent: Number(x.percent) })),
        publish, ...(reason ? { reason } : {}),
      });
      toast({ variant: "success", title: publish && !published ? "Fee structure published." : "Fee structure saved." });
      onSaved();
    } catch (e) { toast({ variant: "destructive", title: (e as Error).message }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Fee Structure" : "Add Fee Structure"}</DialogTitle>
          <DialogDescription>{published ? "Published: a change needs a reason. Accounts already raised keep their fee until you raise fees again (accounts with payments are never changed)." : "Save as a draft, or publish it so fees can be raised from it."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1"><Label className="text-xs">Academic Year</Label><select className={selectClass} value={academicYear} onChange={(e) => setYear(e.target.value)}>{yearChoices(options.academicYear).map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
            <div className="space-y-1"><Label className="text-xs">Course</Label><select className={selectClass} value={courseKey} onChange={(e) => { setCourseKey(e.target.value); setBatch(""); }}>{options.courses.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select></div>
            <div className="space-y-1"><Label className="text-xs">Batch</Label>
              <Input list="fee-batches" value={batch} placeholder="2026-2030" onChange={(e) => setBatch(e.target.value.trim())} />
              <datalist id="fee-batches">{batches.map((b) => <option key={b} value={b} />)}</datalist>
            </div>
            <div className="space-y-1"><Label className="text-xs">Category</Label><select className={selectClass} value={category} onChange={(e) => setCategory(e.target.value as "A" | "B")}><option value="A">Category A (and Spot)</option><option value="B">Category B (Management)</option></select></div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Fee per Year</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {shown.map((h) => (
                <div key={h.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                  <span className="flex-1">{h.name}{!h.bankAccountId && <span className="block text-[11px] text-amber-700 dark:text-amber-300">No bank account (Setup)</span>}</span>
                  {category === "A" && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!fr[h.id]} onChange={(e) => setFr((p) => ({ ...p, [h.id]: e.target.checked }))} />FR</label>}
                  <Input type="number" min={0} step={1} className="w-32 text-right" value={amounts[h.id] ?? ""} placeholder="0" aria-label={`${h.name} amount`} onChange={(e) => setAmounts((p) => ({ ...p, [h.id]: e.target.value }))} />
                </div>
              ))}
            </div>
            <p className="text-right text-sm"><span className="font-semibold">Total {rupee(total)}</span>{category === "A" && <span className="text-muted-foreground"> · FR student pays {rupee(total - frTotal)} (government {rupee(frTotal)}) · NFR / Spot student pays {rupee(total)}</span>}</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between"><p className="text-sm font-medium">Instalments</p><span className={pct === 100 ? "text-xs text-muted-foreground" : "text-xs font-medium text-destructive"}>{pct}% of 100%</span></div>
            {inst.map((x, i) => (
              <div key={i} className="grid grid-cols-[1fr_9rem_6rem_2rem] items-center gap-2">
                <Input value={x.label} maxLength={40} aria-label={`Instalment ${i + 1} name`} onChange={(e) => setInst((p) => p.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
                <Input type="date" value={x.dueDate} aria-label={`Instalment ${i + 1} due date`} onChange={(e) => setInst((p) => p.map((y, j) => (j === i ? { ...y, dueDate: e.target.value } : y)))} />
                <div className="flex items-center gap-1"><Input type="number" min={0} max={100} step={0.01} value={x.percent} aria-label={`Instalment ${i + 1} percent`} onChange={(e) => setInst((p) => p.map((y, j) => (j === i ? { ...y, percent: e.target.value } : y)))} /><span className="text-xs">%</span></div>
                <Button size="icon" variant="ghost" aria-label={`Remove instalment ${i + 1}`} disabled={inst.length === 1} onClick={() => setInst((p) => p.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" disabled={inst.length >= 12} onClick={() => setInst((p) => [...p, { label: `Instalment ${p.length + 1}`, dueDate: "", percent: "" }])}><Plus className="mr-1 h-4 w-4" />Add Instalment</Button>
          </div>

          {published && <div className="space-y-1"><Label htmlFor="fs-reason">Reason for the Change</Label><Input id="fs-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {!published && <Button variant="outline" loading={saving} onClick={() => void save(false)}>Save Draft</Button>}
          <Button loading={saving} onClick={() => void save(true)}>{published ? "Save Changes" : "Publish"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
