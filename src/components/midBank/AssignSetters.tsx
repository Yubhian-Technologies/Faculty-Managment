"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, UserCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

// HOD ("The HOD assigns" colleges): for one deadline, each subject their department looks after - assign who
// prepares it: per branch (each branch its own paper) or one paper for all branches. The list offers faculty
// teaching it there first, then the department's own faculty. Several may be picked; each prepares their own.

interface Candidate { facultyId: string; name: string; department: string; teaches: boolean }
interface Scope {
  branch: string; canAssign: boolean; reviewDepartments: string[];
  sections: { sectionName: string; branch?: string; facultyNames: string[] }[];
  assignment: { facultyIds: string[]; facultyNames: string[]; assignedByName: string; at: string; started: string[] } | null;
  candidates: Candidate[];
}
interface SubjectRow { subjectId: string; subjectName: string; subjectCode: string; ownerDepartments: string[]; branches: Scope[]; whole: Scope | null }

export function AssignSetters({ deadlineId }: { deadlineId: string }) {
  const [data, setData] = useState<{ mode: "SELF" | "HOD"; deadline: { locked: boolean }; subjects: SubjectRow[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let off = false;
    fetch(`/api/college/mid-bank-assignments?deadlineId=${encodeURIComponent(deadlineId)}`)
      .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => { if (!off) { setData(d); setFailed(false); } })
      .catch(() => { if (!off) setFailed(true); });
    return () => { off = true; };
  }, [deadlineId, reloadKey]);

  // A failed load is said, never a silently missing card (the HOD would see only "Setter not assigned yet").
  if (failed && !data) return (
    <Card className="rounded-2xl"><CardContent className="flex items-center justify-between gap-3 p-5 text-sm">
      <span>Couldn&apos;t load the paper setters to assign.</span>
      <Button size="sm" variant="outline" onClick={() => { setFailed(false); setReloadKey((k) => k + 1); }}>Retry</Button>
    </CardContent></Card>
  );
  if (!data || data.mode !== "HOD") return null;
  const subjects = data.subjects.filter((s) => s.branches.some((b) => b.canAssign) || s.whole?.canAssign);
  const unassigned = subjects.filter((s) => !s.whole?.assignment && s.branches.some((b) => b.canAssign && !b.assignment)).length;
  return (
    <Card className="rounded-2xl"><CardContent className="space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 font-semibold"><UserCheck className="h-4 w-4" />Assign paper setters</h2>
        <p className="text-xs text-muted-foreground">
          Only the faculty you assign prepare these; others teaching the subject can view and give suggestions. {unassigned ? `${unassigned} subject${unassigned === 1 ? "" : "s"} still need setters.` : "Every subject has setters."}
        </p>
      </div>
      {subjects.length === 0 && <p className="text-sm text-muted-foreground">No subjects of this semester are looked after by your department.</p>}
      {subjects.map((s) => <SubjectAssign key={s.subjectId} deadlineId={deadlineId} s={s} locked={data.deadline.locked} onSaved={() => setReloadKey((k) => k + 1)} />)}
    </CardContent></Card>
  );
}

function SubjectAssign({ deadlineId, s, locked, onSaved }: { deadlineId: string; s: SubjectRow; locked: boolean; onSaved: () => void }) {
  const wholeOn = !!s.whole?.assignment;
  const branchOn = s.branches.some((b) => b.assignment);
  const [mode, setMode] = useState<"BRANCH" | "SUBJECT">(wholeOn ? "SUBJECT" : "BRANCH");
  const canWhole = !!s.whole?.canAssign && s.branches.length > 1;
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{s.subjectName} <span className="text-xs text-muted-foreground">({s.subjectCode})</span></p>
          <p className="text-xs text-muted-foreground">{s.branches.map((b) => b.branch).join(", ")}{s.ownerDepartments.length ? ` · Subject Department: ${s.ownerDepartments.join(", ")}` : ""}</p>
        </div>
        {canWhole && (
          <div className="flex rounded-lg border p-0.5 text-xs" role="radiogroup" aria-label="Paper for">
            {([["BRANCH", "Per branch"], ["SUBJECT", "One paper for all branches"]] as const).map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={mode === v} disabled={(v === "SUBJECT" && branchOn) || (v === "BRANCH" && wholeOn)}
                title={v === "SUBJECT" && branchOn ? "Remove the per-branch setters first" : v === "BRANCH" && wholeOn ? "Remove the all-branches setters first" : undefined}
                onClick={() => setMode(v)} className={cn("rounded-md px-2.5 py-1 disabled:opacity-40", mode === v ? "bg-primary text-primary-foreground" : "")}>{label}</button>
            ))}
          </div>
        )}
      </div>
      {mode === "SUBJECT" && s.whole
        ? <ScopeAssign deadlineId={deadlineId} subjectId={s.subjectId} scope={s.whole} kind="SUBJECT" locked={locked} onSaved={onSaved} />
        : s.branches.filter((b) => b.canAssign).map((b) => <ScopeAssign key={b.branch} deadlineId={deadlineId} subjectId={s.subjectId} scope={b} kind="BRANCH" locked={locked} onSaved={onSaved} />)}
    </div>
  );
}

function ScopeAssign({ deadlineId, subjectId, scope, kind, locked, onSaved }: { deadlineId: string; subjectId: string; scope: Scope; kind: "BRANCH" | "SUBJECT"; locked: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(scope.assignment?.facultyIds ?? []));
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const started = new Set(scope.assignment?.started ?? []);
  const list = useMemo(() => scope.candidates.filter((c) => !q.trim() || `${c.name} ${c.department}`.toLowerCase().includes(q.trim().toLowerCase())), [scope.candidates, q]);

  async function save(ids: string[]) {
    setBusy(true);
    try {
      const res = await fetch("/api/college/mid-bank-assignments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deadlineId, subjectId, scope: kind, branch: scope.branch, facultyIds: ids }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Could not save");
      toast({ variant: "success", title: ids.length ? "Setters assigned - they are told" : "Assignment removed" });
      setEditing(false);
      onSaved();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not save" }); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-2 rounded-lg bg-muted/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="min-w-0">
          <span className="font-medium">{kind === "SUBJECT" ? "All branches" : scope.branch}</span>
          <span className="ml-2 text-xs text-muted-foreground">{scope.sections.length} section{scope.sections.length === 1 ? "" : "s"}</span>
          <p className={cn("text-xs", scope.assignment ? "text-muted-foreground" : "font-medium text-amber-700")}>
            {scope.assignment ? `Setters: ${scope.assignment.facultyNames.join(", ")}${started.size ? ` · ${started.size} started` : ""}` : "No setter assigned yet"}
          </p>
        </div>
        {!locked && !editing && <Button size="sm" variant={scope.assignment ? "outline" : "default"} onClick={() => { setPicked(new Set(scope.assignment?.facultyIds ?? [])); setEditing(true); }}><Users className="mr-1.5 h-4 w-4" />{scope.assignment ? "Change" : "Assign"}</Button>}
      </div>
      {editing && (
        <div className="space-y-2">
          <div className="relative max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-8 pl-8" placeholder="Search faculty" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border bg-background p-1">
            {list.map((c) => {
              const lockedIn = started.has(c.facultyId);
              return (
                <li key={c.facultyId}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60">
                    <Checkbox checked={picked.has(c.facultyId)} disabled={lockedIn}
                      onCheckedChange={(v) => setPicked((p) => { const n = new Set(p); if (v === true) n.add(c.facultyId); else n.delete(c.facultyId); return n; })} />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", c.teaches ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground")}>{c.teaches ? "Teaches it" : c.department || "Department"}</span>
                    {lockedIn && <span className="shrink-0 text-[10px] text-muted-foreground">started</span>}
                  </label>
                </li>
              );
            })}
            {list.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted-foreground">No faculty found.</li>}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void save([...picked])} loading={busy} disabled={picked.size === 0}>Save {picked.size ? `(${picked.size})` : ""}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            {scope.assignment && started.size === 0 && <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => void save([])} loading={busy}>Remove assignment</Button>}
          </div>
        </div>
      )}
    </div>
  );
}
