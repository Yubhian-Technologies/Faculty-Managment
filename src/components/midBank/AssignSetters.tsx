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
const groupOf = (branches: string[]) => [...new Set(branches)].sort().join(GROUP_JOIN);

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
  /** Question papers the subject gets (Exam Cell's pattern); with 2+ setters the HOD may share them out. */
  paperCount?: number;
}) {
  // Paper number -> the setter who writes it (shared mode), from the saved assignment.
  const savedShare = () => {
    const m: Record<number, string> = {};
    for (const [f, sets] of Object.entries(scope.assignment?.setShare ?? {})) for (const n of sets) m[n] = f;
    return m;
  };
  const [sharing, setSharing] = useState(() => !!scope.assignment?.setShare);
  const [share, setShare] = useState<Record<number, string>>(savedShare);
  const [editing, setEditing] = useState(startEditing);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(scope.assignment?.facultyIds ?? []));
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const started = new Set(scope.assignment?.started ?? []);
  const list = useMemo(() => scope.candidates.filter((c) => !q.trim() || `${c.name} ${c.department}`.toLowerCase().includes(q.trim().toLowerCase())), [scope.candidates, q]);
  const papers = Array.from({ length: paperCount }, (_, i) => i + 1);
  const canShare = paperCount > 1 && picked.size > 1;
  const nameOf = (f: string) => scope.candidates.find((c) => c.facultyId === f)?.name ?? scope.assignment?.facultyNames[scope.assignment.facultyIds.indexOf(f)] ?? "";
  const shareGaps = canShare && sharing ? papers.filter((n) => !share[n] || !picked.has(share[n])) : [];

  async function save(ids: string[]) {
    setBusy(true);
    try {
      const res = await fetch("/api/college/mid-bank-assignments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deadlineId, subjectId, scope: kind, branch: scope.branch, ...(kind === "GROUP" ? { branches: scope.branch.split(GROUP_JOIN) } : {}), facultyIds: ids,
          // Shared: { facultyId: [paper numbers] } - each paper to one of the picked setters.
          ...(canShare && sharing && ids.length > 1 ? { setShare: Object.fromEntries(ids.map((f) => [f, papers.filter((n) => share[n] === f)])) } : {}),
        }),
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
          <span className="font-medium">{kind === "SUBJECT" ? "All branches" : kind === "GROUP" ? `One paper: ${scope.branch.split(GROUP_JOIN).join(", ")}` : scope.branch}</span>
          <span className="ml-2 text-xs text-muted-foreground">{scope.sections.length} section{scope.sections.length === 1 ? "" : "s"}</span>
          <p className={cn("text-xs", scope.assignment ? "text-muted-foreground" : "font-medium text-amber-700")}>
            {scope.assignment
              ? scope.assignment.setShare
                ? `Papers shared: ${Object.entries(scope.assignment.setShare).flatMap(([f, sets]) => sets.map((n) => [n, f] as const)).sort((a, b) => a[0] - b[0]).map(([n, f]) => `Paper ${n} - ${scope.assignment!.facultyNames[scope.assignment!.facultyIds.indexOf(f)] || "?"}`).join(" · ")}${started.size ? ` · ${started.size} started` : ""}`
                : `Setters: ${scope.assignment.facultyNames.join(", ")}${paperCount > 1 ? ` · each writes all ${paperCount} papers` : ""}${started.size ? ` · ${started.size} started` : ""}`
              : "No setter assigned yet"}
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
          {canShare && (
            <div className="space-y-2 rounded-md border bg-background p-2.5">
              <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="How the papers are written">
                <label className="flex items-center gap-1.5"><input type="radio" checked={!sharing} onChange={() => setSharing(false)} />Each writes all {paperCount} papers</label>
                <label className="flex items-center gap-1.5"><input type="radio" checked={sharing} onChange={() => setSharing(true)} />Share the {paperCount} papers among them</label>
              </div>
              {sharing && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {papers.map((n) => (
                    <label key={n} className="flex items-center gap-2 text-sm">
                      <span className="w-16 shrink-0 font-medium">Paper {n}</span>
                      <select className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm" value={picked.has(share[n] ?? "") ? share[n] : ""}
                        onChange={(e) => setShare((m) => ({ ...m, [n]: e.target.value }))}>
                        <option value="">Pick a setter</option>
                        {[...picked].map((f) => <option key={f} value={f}>{nameOf(f)}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              {sharing && shareGaps.length > 0 && <p className="text-xs text-amber-700">Give Paper {shareGaps.join(", ")} to a setter.</p>}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void save([...picked])} loading={busy} disabled={picked.size === 0 || shareGaps.length > 0}>Save {picked.size ? `(${picked.size})` : ""}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); onCancel?.(); }}>Cancel</Button>
            {scope.assignment && started.size === 0 && <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => void save([])} loading={busy}>Remove assignment</Button>}
          </div>
        </div>
      )}
    </div>
  );
}
