"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, UserCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/useToast";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { cn } from "@/lib/utils";

// HOD ("The HOD assigns" colleges): for one deadline, each subject their department looks after - assign who
// prepares it: per branch (each branch its own paper), one paper for a group of branches (e.g. CSE + EEE - the
// paper prints those branches), or one paper for all branches. The list offers faculty teaching it there first,
// then the department's own faculty. Several may be picked; each prepares their own.

interface Candidate { facultyId: string; name: string; department: string; teaches: boolean }
interface Scope {
  branch: string; canAssign: boolean; reviewDepartments: string[];
  sections: { sectionName: string; branch?: string; facultyNames: string[] }[];
  assignment: { facultyIds: string[]; facultyNames: string[]; assignedByName: string; at: string; started: string[]; setShare?: Record<string, number[]> } | null;
  candidates: Candidate[];
}
interface SubjectRow { subjectId: string; subjectName: string; subjectCode: string; ownerDepartments: string[]; branches: Scope[]; groups?: Scope[]; whole: Scope | null; paperCount?: number | null }

const GROUP_JOIN = " + ";

/** What saving does to work a setter already started (from the server's dry run). */
interface StartedChange { kind: "WITHDRAW" | "RESTORE" | "PAPERS"; name: string; from: number[]; to: number[]; resetsApproval: boolean; hiddenQuestions: number }
const changeText = (c: StartedChange) =>
  c.kind === "WITHDRAW" ? `${c.name} is removed: what they wrote is kept, read-only, and the Exam Cell won't see it.`
  : c.kind === "RESTORE" ? `${c.name} is assigned again: their earlier work comes back${c.to.length ? ` (Paper ${c.to.join(", ")})` : ""}.`
  : `${c.name}: Paper ${c.from.join(", ")} becomes Paper ${c.to.join(", ")}.${c.hiddenQuestions ? ` ${c.hiddenQuestions} question${c.hiddenQuestions === 1 ? "" : "s"} written in the papers taken away are kept, hidden until given back.` : ""}${c.resetsApproval ? " It was submitted / approved - it goes back to them to submit again." : ""}`;
const groupOf = (branches: string[]) => [...new Set(branches)].sort().join(GROUP_JOIN);

export function AssignSetters({ deadlineId, onChanged }: { deadlineId: string; /** After a save (the page refreshes its progress). */ onChanged?: () => void }) {
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
      {subjects.map((s) => <SubjectAssign key={s.subjectId} deadlineId={deadlineId} s={s} locked={data.deadline.locked} onSaved={() => { setReloadKey((k) => k + 1); onChanged?.(); }} />)}
    </CardContent></Card>
  );
}

function SubjectAssign({ deadlineId, s, locked, onSaved }: { deadlineId: string; s: SubjectRow; locked: boolean; onSaved: () => void }) {
  const wholeOn = !!s.whole?.assignment;
  const branchOn = s.branches.some((b) => b.assignment) || (s.groups ?? []).some((g) => g.assignment);
  const [mode, setMode] = useState<"BRANCH" | "SUBJECT">(wholeOn ? "SUBJECT" : "BRANCH");
  const canWhole = !!s.whole?.canAssign && s.branches.length > 1;
  // Saved groups (one paper for several branches) and the one being set up now.
  const groups = (s.groups ?? []).filter((g) => g.assignment);
  const grouped = new Set(groups.flatMap((g) => g.branch.split(GROUP_JOIN)));
  const free = s.branches.filter((b) => b.canAssign && !b.assignment && !grouped.has(b.branch));
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [draftGroup, setDraftGroup] = useState<Scope | null>(null);
  function startGroup() {
    const members = s.branches.filter((b) => pick.has(b.branch));
    const seen = new Map<string, Candidate>();
    for (const b of members) for (const c of b.candidates) seen.set(c.facultyId, seen.has(c.facultyId) ? { ...c, teaches: c.teaches || seen.get(c.facultyId)!.teaches } : c);
    setDraftGroup({
      branch: groupOf(members.map((b) => b.branch)), canAssign: true, reviewDepartments: [...new Set(members.flatMap((b) => b.reviewDepartments))],
      sections: members.flatMap((b) => b.sections.map((x) => ({ ...x, branch: b.branch }))), assignment: null,
      candidates: [...seen.values()].sort((a, b) => Number(b.teaches) - Number(a.teaches) || a.name.localeCompare(b.name)),
    });
    setPicking(false);
    setPick(new Set());
  }
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
        ? <ScopeAssign paperCount={s.paperCount ?? 0} deadlineId={deadlineId} subjectId={s.subjectId} scope={s.whole} kind="SUBJECT" locked={locked} onSaved={onSaved} />
        : <>
          {groups.map((g) => <ScopeAssign key={g.branch} paperCount={s.paperCount ?? 0} deadlineId={deadlineId} subjectId={s.subjectId} scope={g} kind="GROUP" locked={locked} onSaved={onSaved} />)}
          {draftGroup && <ScopeAssign key={`new-${draftGroup.branch}`} paperCount={s.paperCount ?? 0} deadlineId={deadlineId} subjectId={s.subjectId} scope={draftGroup} kind="GROUP" locked={locked} startEditing
            onCancel={() => setDraftGroup(null)} onSaved={() => { setDraftGroup(null); onSaved(); }} />}
          {s.branches.filter((b) => b.canAssign && !grouped.has(b.branch) && !(draftGroup?.branch.split(GROUP_JOIN).includes(b.branch))).map((b) => <ScopeAssign key={b.branch} paperCount={s.paperCount ?? 0} deadlineId={deadlineId} subjectId={s.subjectId} scope={b} kind="BRANCH" locked={locked} onSaved={onSaved} />)}
          {/* One paper for several branches: tick the branches (those without setters yet), then pick the setters. */}
          {!locked && !draftGroup && free.length >= 2 && (picking ? (
            <div className="space-y-2 rounded-lg border border-dashed p-3">
              <p className="text-xs font-medium">One paper for these branches (it prints only them):</p>
              <div className="flex flex-wrap gap-3">
                {free.map((b) => (
                  <label key={b.branch} className="flex items-center gap-1.5 text-sm">
                    <Checkbox checked={pick.has(b.branch)} onCheckedChange={(v) => setPick((p) => { const n = new Set(p); if (v === true) n.add(b.branch); else n.delete(b.branch); return n; })} />{b.branch}
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={pick.size < 2} onClick={startGroup}>Next - pick setters</Button>
                <Button size="sm" variant="ghost" onClick={() => { setPicking(false); setPick(new Set()); }}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setPicking(true)}><Users className="mr-1.5 h-4 w-4" />One paper for several branches</Button>
          ))}
        </>}
    </div>
  );
}

function ScopeAssign({ deadlineId, subjectId, scope, kind, locked, onSaved, startEditing = false, onCancel, paperCount = 0 }: {
  deadlineId: string; subjectId: string; scope: Scope; kind: "BRANCH" | "GROUP" | "SUBJECT"; locked: boolean; onSaved: () => void; startEditing?: boolean; onCancel?: () => void;
  /** Question papers the subject gets (Exam Cell's pattern); each setter writes the papers ticked on their row. */
  paperCount?: number;
}) {
  const papers = Array.from({ length: paperCount }, (_, i) => i + 1);
  // Setter -> the papers they write (saved share, else every paper).
  const savedPapers = () => Object.fromEntries((scope.assignment?.facultyIds ?? []).map((f) => [f, scope.assignment?.setShare?.[f] ?? papers]));
  const [papersOf, setPapersOf] = useState<Record<string, number[]>>(savedPapers);
  const [editing, setEditing] = useState(startEditing);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(scope.assignment?.facultyIds ?? []));
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const started = new Set(scope.assignment?.started ?? []);
  const list = useMemo(() => scope.candidates.filter((c) => !q.trim() || `${c.name} ${c.department}`.toLowerCase().includes(q.trim().toLowerCase())), [scope.candidates, q]);
  const multi = paperCount > 1;
  const mine = (f: string) => papersOf[f] ?? papers;
  // Every paper needs a setter; every setter a paper. All setters on every paper = "each writes all" (nothing shared).
  const uncovered = multi ? papers.filter((n) => ![...picked].some((f) => mine(f).includes(n))) : [];
  const empty = multi ? [...picked].filter((f) => mine(f).length === 0) : [];
  const shared = multi && [...picked].some((f) => mine(f).length < paperCount);
  function tick(f: string, on: boolean) {
    setPicked((p) => { const n = new Set(p); if (on) n.add(f); else n.delete(f); return n; });
    // A newly ticked setter takes the papers nobody has yet - or every paper when all are covered.
    if (on) setPapersOf((m) => {
      const free = papers.filter((n) => ![...picked].some((x) => (m[x] ?? papers).includes(n)));
      return { ...m, [f]: free.length ? free : papers };
    });
  }
  const togglePaper = (f: string, n: number) => setPapersOf((m) => {
    const cur = m[f] ?? papers;
    return { ...m, [f]: cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n].sort((a, b) => a - b) };
  });

  // Work already started that a save would change (withdrawn / restored / other papers) - shown before saving.
  const [confirmChanges, setConfirmChanges] = useState<{ ids: string[]; changes: StartedChange[] } | null>(null);

  async function save(ids: string[], confirmed = false) {
    setBusy(true);
    try {
      if (!confirmed) {
        const pre = await fetch("/api/college/mid-bank-assignments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload(ids), dryRun: true }) });
        const pj = (await pre.json()) as { error?: string; changes?: StartedChange[] };
        if (!pre.ok) throw new Error(pj.error ?? "Could not save");
        if (pj.changes?.length) { setConfirmChanges({ ids, changes: pj.changes }); return; }
      }
      setConfirmChanges(null);
      const res = await fetch("/api/college/mid-bank-assignments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(ids)),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Could not save");
      toast({ variant: "success", title: ids.length ? "Setters assigned - they are told" : "Assignment removed" });
      setEditing(false);
      onSaved();
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not save" }); }
    finally { setBusy(false); }
  }

  function payload(ids: string[]) {
    return {
      deadlineId, subjectId, scope: kind, branch: scope.branch, ...(kind === "GROUP" ? { branches: scope.branch.split(GROUP_JOIN) } : {}), facultyIds: ids,
      // Shared: { facultyId: [paper numbers] } - only when some setter writes fewer than every paper.
      ...(shared ? { setShare: Object.fromEntries(ids.map((f) => [f, mine(f)])) } : {}),
    };
  }

  return (
    <div className="space-y-2 rounded-lg bg-muted/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="min-w-0">
          <span className="font-medium">{kind === "SUBJECT" ? "All branches" : kind === "GROUP" ? `One paper: ${scope.branch.split(GROUP_JOIN).join(", ")}` : scope.branch}</span>
          <span className="ml-2 text-xs text-muted-foreground">{scope.sections.length} section{scope.sections.length === 1 ? "" : "s"}</span>
          <p className={cn("text-xs", scope.assignment ? "text-muted-foreground" : "font-medium text-amber-700")}>
            {scope.assignment
              ? scope.assignment.setShare
                ? `Setters: ${scope.assignment.facultyIds.map((f, i) => `${scope.assignment!.facultyNames[i] || "?"} (Paper ${(scope.assignment!.setShare![f] ?? papers).join(", ")})`).join(" · ")}${started.size ? ` · ${started.size} started` : ""}`
                : `Setters: ${scope.assignment.facultyNames.join(", ")}${paperCount > 1 ? ` · each writes all ${paperCount} papers` : ""}${started.size ? ` · ${started.size} started` : ""}`
              : "No setter assigned yet"}
          </p>
        </div>
        {!locked && !editing && <Button size="sm" variant={scope.assignment ? "outline" : "default"} onClick={() => { setPicked(new Set(scope.assignment?.facultyIds ?? [])); setPapersOf(savedPapers()); setEditing(true); }}><Users className="mr-1.5 h-4 w-4" />{scope.assignment ? "Change" : "Assign"}</Button>}
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
                <li key={c.facultyId} className="flex flex-wrap items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <Checkbox checked={picked.has(c.facultyId)} onCheckedChange={(v) => tick(c.facultyId, v === true)} />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  </label>
                  {/* The papers this setter writes (Exam Cell's pattern gives the subject more than one). */}
                  {multi && picked.has(c.facultyId) && (
                    <span className="flex items-center gap-1" role="group" aria-label={`Papers ${c.name} writes`}>
                      <span className="text-[11px] text-muted-foreground">Paper</span>
                      {papers.map((n) => {
                        const on = mine(c.facultyId).includes(n);
                        return (
                          <button key={n} type="button" aria-pressed={on} onClick={() => togglePaper(c.facultyId, n)}
                            className={cn("h-6 min-w-6 rounded-full border px-1.5 text-xs font-semibold disabled:opacity-60", on ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground")}>{n}</button>
                        );
                      })}
                    </span>
                  )}
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", c.teaches ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground")}>{c.teaches ? "Teaches it" : c.department || "Department"}</span>
                  {lockedIn && <span className="shrink-0 text-[10px] text-muted-foreground">started</span>}
                </li>
              );
            })}
            {list.length === 0 && <li className="px-2 py-3 text-center text-xs text-muted-foreground">No faculty found.</li>}
          </ul>
          {multi && picked.size > 0 && (uncovered.length > 0 || empty.length > 0) && (
            <p className="text-xs text-amber-700">
              {[uncovered.length ? `Paper ${uncovered.join(", ")} ${uncovered.length === 1 ? "has" : "have"} no setter` : "", empty.length ? `${empty.map((f) => scope.candidates.find((c) => c.facultyId === f)?.name ?? "A setter").join(", ")}: pick at least one paper` : ""].filter(Boolean).join(" · ")}
            </p>
          )}
          <ConfirmDialog
            open={confirmChanges !== null}
            onOpenChange={(o) => { if (!o) setConfirmChanges(null); }}
            title="This changes work already started"
            description="Nothing written is deleted. Continue?"
            confirmLabel="Save"
            loading={busy}
            onConfirm={() => (confirmChanges ? save(confirmChanges.ids, true) : undefined)}
          >
            <ul className="list-disc space-y-1 pl-5 text-sm">{(confirmChanges?.changes ?? []).map((c, i) => <li key={i}>{changeText(c)}</li>)}</ul>
          </ConfirmDialog>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void save([...picked])} loading={busy} disabled={picked.size === 0 || uncovered.length > 0 || empty.length > 0}>Save {picked.size ? `(${picked.size})` : ""}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); onCancel?.(); }}>Cancel</Button>
            {scope.assignment && <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => void save([])} loading={busy}>Remove assignment</Button>}
          </div>
        </div>
      )}
    </div>
  );
}
