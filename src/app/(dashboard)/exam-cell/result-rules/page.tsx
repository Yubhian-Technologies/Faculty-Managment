"use client";

import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { DEFAULT_GRADE_TABLE_KEY, type ExamResultRules, type GpaShowRule } from "@/types/examResults";

// Result Rules - the Exam Cell's grade table(s) and when SGPA / CGPA are shown.
// The two formulas themselves are fixed (lib/examResults/gpa.ts); only the
// grades and these show rules are the college's to set.

type Row = { grade: string; points: string; isPass: boolean };
type Tables = { key: string; rows: Row[] }[];

const SHOW_OPTIONS: { value: GpaShowRule; label: string; hint: string }[] = [
  { value: "ALL_PASSED", label: "Only when all passed", hint: "Not shown while any subject it covers is failed; appears once the backlog is cleared." },
  { value: "ALWAYS", label: "Always", hint: "Always worked out; a failed subject counts 0 points with its credits." },
];

function toTables(rules: ExamResultRules): Tables {
  const keys = Object.keys(rules.gradeTables).sort((a, b) => (a === DEFAULT_GRADE_TABLE_KEY ? -1 : b === DEFAULT_GRADE_TABLE_KEY ? 1 : a.localeCompare(b)));
  return keys.map((key) => ({ key, rows: rules.gradeTables[key].map((g) => ({ grade: g.grade, points: String(g.points), isPass: g.isPass })) }));
}

function ShowRulePicker({ label, value, onChange }: { label: string; value: GpaShowRule; onChange: (v: GpaShowRule) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid gap-2 sm:grid-cols-2">
        {SHOW_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`rounded-lg border p-3 text-left transition-colors ${value === o.value ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
          >
            <p className="text-sm font-medium">{o.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{o.hint}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ExamResultRulesPage() {
  const [tables, setTables] = useState<Tables>([]);
  const [showSgpa, setShowSgpa] = useState<GpaShowRule>("ALL_PASSED");
  const [showCgpa, setShowCgpa] = useState<GpaShowRule>("ALL_PASSED");
  const [decimals, setDecimals] = useState("2");
  const [saved, setSaved] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [newRegulation, setNewRegulation] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/college/exam-results/rules");
        const json = (await res.json()) as { rules?: ExamResultRules; saved?: boolean; error?: string };
        if (!res.ok || !json.rules) throw new Error(json.error);
        if (cancelled) return;
        setTables(toTables(json.rules));
        setShowSgpa(json.rules.showSgpa);
        setShowCgpa(json.rules.showCgpa);
        setDecimals(String(json.rules.decimals));
        setSaved(json.saved === true);
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load result rules" });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function updateRow(tableKey: string, index: number, patch: Partial<Row>) {
    setTables((ts) => ts.map((t) => (t.key === tableKey ? { ...t, rows: t.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)) } : t)));
  }
  function addRow(tableKey: string) {
    setTables((ts) => ts.map((t) => (t.key === tableKey ? { ...t, rows: [...t.rows, { grade: "", points: "", isPass: true }] } : t)));
  }
  function removeRow(tableKey: string, index: number) {
    setTables((ts) => ts.map((t) => (t.key === tableKey ? { ...t, rows: t.rows.filter((_, i) => i !== index) } : t)));
  }
  function addRegulation() {
    const key = newRegulation.trim().toUpperCase();
    if (!key) return;
    if (tables.some((t) => t.key === key)) {
      toast({ variant: "destructive", title: `${key} already has a grade table` });
      return;
    }
    const base = tables.find((t) => t.key === DEFAULT_GRADE_TABLE_KEY)?.rows ?? [];
    setTables((ts) => [...ts, { key, rows: base.map((r) => ({ ...r })) }]);
    setNewRegulation("");
  }

  async function save() {
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/exam-results/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          showSgpa, showCgpa, decimals: Number(decimals),
          gradeTables: Object.fromEntries(tables.map((t) => [t.key, t.rows.map((r) => ({ grade: r.grade, points: r.points, isPass: r.isPass }))])),
        }),
      });
      const json = (await res.json()) as { rules?: ExamResultRules; error?: string };
      if (!res.ok || !json.rules) {
        toast({ variant: "destructive", title: json.error ?? "Could not save the rules" });
        return;
      }
      setTables(toTables(json.rules));
      setSaved(true);
      toast({ variant: "success", title: "Result rules saved" });
    } catch {
      toast({ variant: "destructive", title: "Network error - rules not saved" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Result Rules"
        description="Grade points and when SGPA / CGPA are shown. SGPA = Σ(credits × grade points) ÷ Σ credits of the semester; CGPA = Σ(semester credits × SGPA) ÷ Σ semester credits."
      />

      {!isLoading && !saved && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          These are starter rules - nothing is saved for your college yet. Check the grades and points against your regulation and press Save.
        </div>
      )}

      {isLoading ? (
        <div className="h-96 rounded-lg border bg-muted/30 animate-pulse" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">When SGPA and CGPA are shown</CardTitle>
              <CardDescription>Applies to every student of the college.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <ShowRulePicker label="SGPA (one semester)" value={showSgpa} onChange={setShowSgpa} />
              <ShowRulePicker label="CGPA (all semesters so far)" value={showCgpa} onChange={setShowCgpa} />
              <div className="max-w-[200px] space-y-1.5">
                <Label htmlFor="rr-decimals">Decimal places</Label>
                <Input id="rr-decimals" type="number" min={0} max={4} value={decimals} onChange={(e) => setDecimals(e.target.value)} />
              </div>
            </CardContent>
          </Card>

          {tables.map((t) => (
            <Card key={t.key}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-base">
                    {t.key === DEFAULT_GRADE_TABLE_KEY ? "Default grade table" : `${t.key} grade table`}
                  </CardTitle>
                  <CardDescription>
                    {t.key === DEFAULT_GRADE_TABLE_KEY
                      ? "Used for every regulation that has no table of its own. Absent / Malpractice / Withheld are failing grades worth 0."
                      : `Used for results imported under regulation ${t.key}.`}
                  </CardDescription>
                </div>
                {t.key !== DEFAULT_GRADE_TABLE_KEY && (
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setTables((ts) => ts.filter((x) => x.key !== t.key))}>
                    <Trash2 className="mr-1.5 h-4 w-4" />Remove table
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span>Grade</span><span>Grade points</span><span>Pass</span><span />
                </div>
                {t.rows.map((r, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
                    <Input value={r.grade} onChange={(e) => updateRow(t.key, i, { grade: e.target.value.toUpperCase() })} placeholder="e.g. S" aria-label="Grade" />
                    <Input type="number" min={0} step="0.5" value={r.points} onChange={(e) => updateRow(t.key, i, { points: e.target.value })} placeholder="e.g. 10" aria-label="Grade points" />
                    <div className="flex items-center gap-2 px-2">
                      <Checkbox checked={r.isPass} onCheckedChange={(v) => updateRow(t.key, i, { isPass: v === true })} aria-label="Counts as a pass" />
                      <Badge variant={r.isPass ? "secondary" : "destructive"} className="w-12 justify-center">{r.isPass ? "Pass" : "Fail"}</Badge>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => removeRow(t.key, i)} aria-label="Remove grade">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => addRow(t.key)}>
                  <Plus className="mr-1.5 h-4 w-4" />Add grade
                </Button>
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">A different grade table for a regulation</CardTitle>
              <CardDescription>Only if a regulation grades differently from the default. It starts as a copy of the default.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="rr-regulation">Regulation</Label>
                <Input id="rr-regulation" value={newRegulation} onChange={(e) => setNewRegulation(e.target.value)} placeholder="e.g. R23" className="w-40" />
              </div>
              <Button variant="outline" onClick={addRegulation} disabled={!newRegulation.trim()}>
                <Plus className="mr-1.5 h-4 w-4" />Add table
              </Button>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={() => void save()} loading={isSaving}>
              <Save className="mr-1.5 h-4 w-4" />Save rules
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
