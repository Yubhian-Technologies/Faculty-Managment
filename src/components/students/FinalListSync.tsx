"use client";

import { useMemo, useState } from "react";
import { Download, FileUp, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { cn, dmy } from "@/lib/utils";
import type { ChangedField, MissingStudent, MovedStudent, NewStudent, RollChange, SyncPlan, SyncRow } from "@/lib/students/finalListSync";

// College Office > Students > Import > "Sync with Final List". The college's final list for one year (Branch, Regd. No,
// Name, Type, M/F, Section) is compared with the app (POST students/final-list-sync - writes nothing), then the ticked
// changes are applied through the routes that own each one, in this order: students who left -> lifecycle DISCONTINUE
// (frees their number), Regd. No changes -> students/renumber (all at once, so shifted numbers work), section moves ->
// bulk-move, new students -> import-excel, details -> students/[id] PATCH. People are matched by Hall Ticket No / name,
// never by number alone (the college may have renumbered). Nothing is deleted.

type Plan = SyncPlan & { courseName: string; courseNames: string[]; departments: string[]; can: { add: boolean; move: boolean; discontinue: boolean; edit: boolean } };
type Outcome = { label: string; done: number; failed: string[] };

const HEADERS: [keyof Omit<SyncRow, "line">, RegExp][] = [
  ["roll", /^(regd\.?\s*no\.?|reg\.?\s*no\.?|regd|roll\.?\s*no\.?|registration\s*no\.?)$/i],
  ["branch", /^(branch|dept|department)$/i],
  ["name", /^(name|name of the candidate|student name|candidate name)$/i],
  ["type", /^(type|admission type|category of admission)$/i],
  ["gender", /^(m\/f|gender|sex)$/i],
  ["section", /^(section|sec)$/i],
  ["hallTicket", /^(hall\s*ticket\s*no\.?|hallticket no\.?|hall ticket)$/i],
  ["rank", /^(rank|eamcet rank|entrance rank)$/i],
];

function csvCells(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Reads the list (Excel or CSV): finds its header row (the one with a Regd. No column), then one student per row. */
async function readList(file: File): Promise<SyncRow[]> {
  let grid: string[][];
  if (/\.csv$/i.test(file.name)) {
    grid = (await file.text()).split(/\r?\n/).map(csvCells);
  } else {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) throw new Error("The file has no sheet.");
    const text = (v: unknown): string => {
      if (v == null) return "";
      if (typeof v === "object") { const o = v as { text?: string; result?: unknown; richText?: { text: string }[] }; return o.richText ? o.richText.map((x) => x.text).join("") : String(o.text ?? o.result ?? ""); }
      return String(v);
    };
    grid = [];
    ws.eachRow({ includeEmpty: true }, (row) => { grid.push((row.values as unknown[]).slice(1).map(text)); });
  }
  const headerAt = grid.findIndex((r) => r.some((c) => HEADERS[0][1].test(c.trim())));
  if (headerAt < 0) throw new Error("The file needs a header row with a Regd. No column (REGD.NO).");
  const head = grid[headerAt].map((c) => c.trim());
  const col = Object.fromEntries(HEADERS.map(([k, re]) => [k, head.findIndex((h) => re.test(h))])) as Record<string, number>;
  if (col.branch < 0 || col.section < 0) throw new Error("The file needs Branch and Section columns.");
  return grid.slice(headerAt + 1)
    .map((r, i) => ({
      line: headerAt + i + 2,
      roll: (r[col.roll] ?? "").trim(), branch: (r[col.branch] ?? "").trim(), name: col.name >= 0 ? (r[col.name] ?? "").trim() : "",
      type: col.type >= 0 ? r[col.type]?.trim() : "", gender: col.gender >= 0 ? r[col.gender]?.trim() : "", section: (r[col.section] ?? "").trim(),
      hallTicket: col.hallTicket >= 0 ? r[col.hallTicket]?.trim() : "", rank: col.rank >= 0 ? r[col.rank]?.trim() : "",
    }))
    .filter((r) => r.roll && !/^regd/i.test(r.roll));
}

function downloadCsv(name: string, rows: (string | number)[][]) {
  const text = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

export function FinalListSync() {
  const [year, setYear] = useState("1");
  const [courseName, setCourseName] = useState("");
  const [joinedOn, setJoinedOn] = useState("");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<SyncRow[] | null>(null);
  const [branchMap, setBranchMap] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState("");
  const [off, setOff] = useState<Set<string>>(new Set()); // unticked items, keyed "<kind>:<id>"
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function compare(list = rows, map = branchMap, course = courseName) {
    if (!list) return;
    setBusy("Comparing with the app...");
    try {
      const r = await fetch("/api/college/students/final-list-sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: Number(year), courseName: course || undefined, rows: list, branchMap: map }),
      });
      const j = await r.json();
      if (!r.ok) {
        if (Array.isArray(j.courseNames)) setPlan((p) => (p ? { ...p, courseNames: j.courseNames } : ({ courseNames: j.courseNames } as Plan)));
        throw new Error(j.error ?? "Unable to compare the list");
      }
      setPlan(j as Plan);
      setCourseName((j as Plan).courseName);
      // Untick by default: students with no Regd. No (nothing to match them by - check them by hand).
      setOff(new Set((j as Plan).missing.filter((m) => m.noRoll).map((m) => `missing:${m.studentId}`)));
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to compare the list" });
    } finally { setBusy(""); }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setOutcomes(null); setPlan(null); setBranchMap({});
    try {
      const list = await readList(file);
      if (list.length === 0) throw new Error("No students found in the file.");
      setRows(list); setFileName(file.name);
      await compare(list, {});
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to read the file" });
    }
  }

  const on = (key: string) => !off.has(key);
  const toggle = (key: string) => setOff((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const chosen = useMemo(() => plan ? {
    rollChanges: plan.rollChanges.filter((c) => on(`roll:${c.studentId}`)),
    added: plan.can.add ? plan.added.filter((a) => on(`new:${a.roll}`)) : [],
    moved: plan.can.move ? plan.moved.filter((m) => on(`move:${m.studentId}`)) : [],
    // A student whose number the list gives to someone else is always included (the number has to move off them).
    missing: plan.missing.filter((m) => m.numberReused || on(`missing:${m.studentId}`)),
    changed: plan.changed.filter((c) => on(`change:${c.studentId}:${c.field}`)),
  } : null, [plan, off]); // eslint-disable-line react-hooks/exhaustive-deps

  async function apply() {
    if (!plan || !chosen) return;
    setConfirming(false);
    const results: Outcome[] = [];
    const reason = `Not in the final students list${fileName ? ` (${fileName})` : ""}`;
    try {
      if (chosen.missing.length) {
        const out: Outcome = { label: "Marked Discontinued", done: 0, failed: [] };
        for (let i = 0; i < chosen.missing.length; i++) {
          const m: MissingStudent = chosen.missing[i];
          setBusy(`Marking Discontinued ${i + 1} of ${chosen.missing.length}...`);
          const r = await fetch(`/api/college/students/${encodeURIComponent(m.studentId)}/lifecycle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "DISCONTINUE", reason }) });
          const j = await r.json().catch(() => ({}));
          if (r.ok) out.done += 1; else out.failed.push(`${m.roll || m.name}: ${j.error ?? "Unable to update"}`);
        }
        results.push(out);
      }
      if (chosen.rollChanges.length || chosen.missing.some((m) => m.numberReused)) {
        setBusy(`Changing ${chosen.rollChanges.length} Regd. Nos...`);
        const out: Outcome = { label: "Regd. No changed", done: 0, failed: [] };
        const r = await fetch("/api/college/students/renumber", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            changes: chosen.rollChanges.map((c: RollChange) => ({ studentId: c.studentId, to: c.to })),
            release: chosen.missing.filter((m) => m.numberReused).map((m) => m.studentId),
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) out.failed.push(...(Array.isArray(j.problems) && j.problems.length ? j.problems : [j.error ?? "Unable to change the Regd. Nos"]));
        else { out.done = j.changed ?? 0; out.failed.push(...(j.failed ?? [])); }
        results.push(out);
        // Nothing else may run on numbers that didn't change as planned.
        if (!r.ok) throw new Error("STOP");
      }
      if (chosen.added.length) {
        setBusy(`Adding ${chosen.added.length} students...`);
        const out: Outcome = { label: "Added", done: 0, failed: [] };
        const records = chosen.added.map((a: NewStudent) => ({
          rollNumber: a.roll, name: a.name, department: a.department, section: a.section, year: Number(year), course: a.courseName ?? plan.courseName,
          ...(a.gender ? { gender: a.gender } : {}), ...(a.admissionType ? { admissionType: a.admissionType } : {}),
          ...(a.hallTicket ? { hallTicketNo: a.hallTicket } : {}), ...(a.rank ? { entranceRank: a.rank } : {}),
          ...(joinedOn ? { dateOfJoining: joinedOn } : {}),
        }));
        for (let i = 0; i < records.length; i += 500) {
          const r = await fetch("/api/college/students/import-excel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ records: records.slice(i, i + 500) }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) { out.failed.push(j.error ?? "Unable to add students"); break; }
          out.done += j.created ?? 0;
          for (const f of j.failed ?? []) out.failed.push(`${f.rollNumber}: ${f.error}`);
        }
        results.push(out);
      }
      if (chosen.moved.length) {
        setBusy(`Moving ${chosen.moved.length} students...`);
        const out: Outcome = { label: "Moved to the listed section", done: 0, failed: [] };
        const byTarget = new Map<string, MovedStudent[]>();
        for (const m of chosen.moved) byTarget.set(m.toSectionId, [...(byTarget.get(m.toSectionId) ?? []), m]);
        for (const [targetSectionId, list] of byTarget) {
          for (let i = 0; i < list.length; i += 200) {
            const r = await fetch("/api/college/students/bulk-move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentIds: list.slice(i, i + 200).map((m) => m.studentId), targetSectionId }) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) { out.failed.push(`${list[0].to}: ${j.error ?? "Unable to move"}`); continue; }
            out.done += j.moved ?? 0;
            for (const s of j.skipped ?? []) out.failed.push(`${s.name}: ${s.reason}`);
          }
        }
        results.push(out);
      }
      if (chosen.changed.length) {
        const out: Outcome = { label: "Details corrected", done: 0, failed: [] };
        const byStudent = new Map<string, ChangedField[]>();
        for (const c of chosen.changed) byStudent.set(c.studentId, [...(byStudent.get(c.studentId) ?? []), c]);
        let n = 0;
        for (const [id, list] of byStudent) {
          setBusy(`Correcting details ${++n} of ${byStudent.size}...`);
          const r = await fetch(`/api/college/students/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ details: Object.fromEntries(list.map((c) => [c.field, c.to])) }) });
          const j = await r.json().catch(() => ({}));
          if (r.ok) out.done += 1; else out.failed.push(`${list[0].roll}: ${j.error ?? "Unable to update"}`);
        }
        results.push(out);
      }
    } catch (e) {
      if (!(e instanceof Error && e.message === "STOP")) throw e;
    } finally {
      setBusy("");
      setOutcomes(results);
      toast({ title: "Final list applied." });
      await compare();
    }
  }

  const unmatched = plan?.branches?.filter((b) => !b.department) ?? [];
  const total = chosen ? chosen.rollChanges.length + chosen.added.length + chosen.moved.length + chosen.missing.length + chosen.changed.length : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Sync with the College&apos;s Final List</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload the final students list for a year (Branch, Regd. No, Name, Type, M/F, Section - Excel or CSV, as the college prepares it).
            It is compared with the app first; nothing changes until you review it and press Apply. Nobody is deleted - students who left are marked Discontinued, with their history kept.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="fls-year">Year of Study</Label>
              <select id="fls-year" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={year} onChange={(e) => { setYear(e.target.value); setPlan(null); }}>
                {[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>Year {y}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fls-course">Course</Label>
              <select id="fls-course" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={courseName}
                onChange={(e) => { setCourseName(e.target.value); if (rows) void compare(rows, branchMap, e.target.value); }}>
                <option value="">{plan?.courseNames?.length ? "Select course" : "Found from the list"}</option>
                {(plan?.courseNames ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fls-doj">Date of Joining for New Students</Label>
              <Input id="fls-doj" type="date" value={joinedOn} onChange={(e) => setJoinedOn(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">
              <FileUp className="h-4 w-4" />{fileName ? "Choose Another File" : "Choose the Final List"}
              <input type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {fileName && <span className="text-sm text-muted-foreground">{fileName} · {rows?.length ?? 0} students</span>}
            {rows && <Button variant="outline" size="sm" onClick={() => void compare()} loading={!!busy}><RefreshCw className="mr-1.5 h-4 w-4" />Compare Again</Button>}
            {busy && <span className="text-sm text-muted-foreground">{busy}</span>}
          </div>
          {joinedOn ? null : <p className="text-xs text-muted-foreground">Leave the Date of Joining blank if the new students were there from the start of the year; with a date, their attendance counts from that day.</p>}
        </CardContent>
      </Card>

      {plan?.branches && plan.branches.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Branches in the List</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {plan.branches.map((b) => (
                <div key={b.branch} className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-sm", !b.department && "border-red-300 bg-red-50")}>
                  <span className="w-20 shrink-0 font-semibold">{b.branch}</span>
                  <select aria-label={`Department for ${b.branch}`} className="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-sm"
                    value={branchMap[b.branch] ?? b.department ?? ""}
                    onChange={(e) => { const m = { ...branchMap, [b.branch]: e.target.value }; setBranchMap(m); void compare(rows, m); }}>
                    <option value="">Not matched - choose</option>
                    {plan.departments.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <span className="shrink-0 text-xs text-muted-foreground">{b.rows}</span>
                </div>
              ))}
            </div>
            {unmatched.length > 0 && <p className="mt-2 text-xs text-red-700">Choose a department for each branch shown in red; its students are left out until then.</p>}
          </CardContent>
        </Card>
      )}

      {plan?.added && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {[
              ["Unchanged", plan.unchanged, "text-emerald-700"],
              ["Regd. No Changes", plan.rollChanges.length, "text-indigo-700"],
              ["New Students", plan.added.length, "text-blue-700"],
              ["Section Changes", plan.moved.length, "text-violet-700"],
              ["Not in the List", plan.missing.length, "text-amber-700"],
              ["Detail Corrections", plan.changed.length, "text-slate-700"],
              ["Problems", plan.problems.length, "text-red-700"],
            ].map(([label, n, c]) => (
              <div key={label as string} className="rounded-xl border bg-card p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={cn("text-2xl font-bold tabular-nums", c as string)}>{n as number}</p>
              </div>
            ))}
          </div>

          <Group title="Regd. No Changes" note="The same student under a new number (matched by Hall Ticket No or name - never by number alone). All of them change together; attendance, marks and history stay with each student, and the old number is kept on the record."
            items={plan.rollChanges} keyOf={(c) => `roll:${c.studentId}`} on={on} toggle={toggle}
            head={["Name", "Department", "Regd. No Now", "New Regd. No", "Matched By"]}
            cells={(c) => [c.name, c.department, c.from, c.to, c.matchedBy === "hallTicket" ? "Hall Ticket No" : c.matchedBy === "name" ? "Name" : `Close spelling (list: ${c.listName})`]} />
          <Group title="New Students" note={plan.can.add ? "Added in the listed section." : "Only the College Office can add students."}
            items={plan.added} keyOf={(a) => `new:${a.roll}`} on={on} toggle={toggle} disabled={!plan.can.add}
            head={["Regd. No", "Name", "Department", "Section", "Type"]}
            cells={(a) => [a.roll, a.name, a.department, a.section, a.admissionType ?? "-"]} />
          <Group title="Section Changes" note={plan.can.move ? "Moved to the section the list gives." : "Section moves are made by the HOD or the Principal - download this list for them."}
            items={plan.moved} keyOf={(m) => `move:${m.studentId}`} on={on} toggle={toggle} disabled={!plan.can.move}
            head={["Regd. No", "Name", "Department", "From", "To"]} cells={(m) => [m.roll, m.name, m.department, m.from, m.to]} />
          <Group title="Not in the List" note="In the app but not in the final list. Ticked students are marked Discontinued (their records and attendance stay; they leave every class). Untick anyone still studying. A student whose number the list gives to someone else is always included - their number moves to the new holder and is kept on their record as the previous Regd. No."
            items={plan.missing} keyOf={(m) => `missing:${m.studentId}`} on={(k) => on(k) || plan.missing.some((m) => m.numberReused && k === `missing:${m.studentId}`)} toggle={toggle}
            locked={(m) => !!m.numberReused}
            head={["Regd. No", "Name", "Department", "Section", "Note"]} cells={(m) => [m.roll || "(no Regd. No)", m.name, m.department, m.section, m.numberReused ? "Number given to someone else in the list" : m.noRoll ? "No Regd. No - check by hand" : ""]} />
          <Group title="Detail Corrections" note="Name, gender or admission type differ from the list. Ticked ones are updated to the list's value."
            items={plan.changed} keyOf={(c) => `change:${c.studentId}:${c.field}`} on={on} toggle={toggle}
            head={["Regd. No", "Name", "Field", "In the App", "In the List"]} cells={(c) => [c.roll, c.name, c.label, c.from, c.to]} />
          {plan.problems.length > 0 && (
            <Card className="border-red-200">
              <CardHeader className="flex flex-row items-center justify-between gap-2"><CardTitle className="text-base text-red-700">Problems ({plan.problems.length})</CardTitle>
                <Button size="sm" variant="outline" onClick={() => downloadCsv("final-list-problems.csv", [["Line", "Regd. No", "Problem"], ...plan.problems.map((p) => [p.line, p.roll, p.message])])}><Download className="mr-1.5 h-4 w-4" />Download</Button>
              </CardHeader>
              <CardContent><ul className="max-h-64 space-y-1 overflow-y-auto text-sm">{plan.problems.map((p, i) => <li key={i}><span className="font-medium">Line {p.line} · {p.roll}</span> - {p.message}</li>)}</ul>
                <p className="mt-2 text-xs text-muted-foreground">These rows are skipped. Fix them (or the app) and compare again.</p></CardContent>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
            {confirming ? (
              <>
                <p className="text-sm font-medium">Apply {total} change{total === 1 ? "" : "s"}{joinedOn && chosen?.added.length ? ` (new students joined ${dmy(joinedOn)})` : ""}?</p>
                <Button onClick={() => void apply()} loading={!!busy}>Yes, Apply</Button>
                <Button variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
              </>
            ) : (
              <>
                <Button onClick={() => setConfirming(true)} disabled={!!busy || total === 0}>Apply Ticked Changes ({total})</Button>
                <Button variant="outline" onClick={() => downloadCsv("final-list-changes.csv", [
                  ["Change", "Regd. No", "Name", "Department", "Detail"],
                  ...plan.rollChanges.map((c) => ["Regd. No change", c.to, c.name, c.department, `${c.from} -> ${c.to}`]),
                  ...plan.added.map((a) => ["New", a.roll, a.name, a.department, `Section ${a.section}`]),
                  ...plan.moved.map((m) => ["Section change", m.roll, m.name, m.department, `${m.from} -> ${m.to}`]),
                  ...plan.missing.map((m) => ["Not in the list", m.roll, m.name, m.department, m.section]),
                  ...plan.changed.map((c) => ["Detail", c.roll, c.name, "", `${c.label}: ${c.from} -> ${c.to}`]),
                ])}><Download className="mr-1.5 h-4 w-4" />Download All Changes</Button>
              </>
            )}
          </div>
        </>
      )}

      {outcomes && outcomes.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Result</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {outcomes.map((o) => (
              <div key={o.label}>
                <p><span className="font-semibold">{o.label}:</span> {o.done}{o.failed.length ? ` · ${o.failed.length} not done` : ""}</p>
                {o.failed.length > 0 && <ul className="ml-4 list-disc text-xs text-red-700">{o.failed.slice(0, 30).map((f, i) => <li key={i}>{f}</li>)}</ul>}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">The comparison above was run again on the updated records.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Group<T>({ title, note, items, keyOf, on, toggle, disabled, locked, head, cells }: {
  title: string; note: string; items: T[]; keyOf: (t: T) => string; on: (k: string) => boolean; toggle: (k: string) => void;
  disabled?: boolean; locked?: (t: T) => boolean; head: string[]; cells: (t: T) => string[];
}) {
  const [open, setOpen] = useState(items.length > 0 && items.length <= 30);
  if (items.length === 0) return null;
  const ticked = items.filter((t) => on(keyOf(t))).length;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">{title} ({items.length})</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{note}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show"} ({disabled ? 0 : ticked} ticked)</Button>
      </CardHeader>
      {open && (
        <CardContent>
          <div className="max-h-96 overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                <tr><th className="w-10 px-3 py-2" />{head.map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y">
                {items.map((t) => {
                  const k = keyOf(t);
                  return (
                    <tr key={k} className={cn(!on(k) && "text-muted-foreground")}>
                      <td className="px-3 py-1.5"><input type="checkbox" className="h-4 w-4" aria-label={`Include ${cells(t)[0]}`} checked={!disabled && on(k)} disabled={disabled || locked?.(t)} onChange={() => toggle(k)} /></td>
                      {cells(t).map((c, i) => <td key={i} className="px-3 py-1.5">{c}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
