"use client";

import { useFacultyDisplayNames } from "@/hooks/useFacultyDisplayNames";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getJson } from "@/components/mentoring/record/recordApi";
import type { MenteeSummary, MentoringOverviewRow } from "@/types/mentoring";

type FinderOptions = { departments: string[]; sections: { department: string; year: number; name: string }[] };
type Page = { students: MenteeSummary[]; nextCursor: string | null };
const ANY = "all";

function FilterSelect({ label, value, onChange, options, disabled }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; disabled?: boolean }) {
  return (
    <div className="min-w-[10rem]">
      <label className="text-xs text-muted-foreground mb-1 block">{label}</label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

// Principal / Vice-Principal: filters first, never a whole-college list. Pick a department (then
// year / section / mentor) and only that slice is read, 50 at a time; or type a Regd. No for a
// direct lookup. Each row opens the student's read-only Mentoring Record.
export function StudentFinder({ byDepartment, byMentor }: { byDepartment: MentoringOverviewRow[]; byMentor: MentoringOverviewRow[] }) {
  // Settings > Website Display Name > "Student mentoring": the mentor shown by Display Name - display only.
  const { nameFor } = useFacultyDisplayNames();
  const allMentors = useMemo(() => byMentor.map((m) => ({ uid: m.key, name: m.label })).sort((a, b) => a.name.localeCompare(b.name)), [byMentor]);
  const [options, setOptions] = useState<FinderOptions | null>(null);
  const [department, setDepartment] = useState(ANY);
  const [year, setYear] = useState(ANY);
  const [section, setSection] = useState(ANY);
  const [mentor, setMentor] = useState(ANY);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<MenteeSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const term = q.trim();
  const mentorUid = mentor.startsWith("uid:") ? mentor.slice(4) : "";

  // With a department picked, only that department's mentors are offered (fetched once per department);
  // without one, every mentor of the college.
  const [deptMentors, setDeptMentors] = useState<{ department: string; list: { uid: string; name: string }[] } | null>(null);
  useEffect(() => {
    if (department === ANY) return;
    let cancelled = false;
    getJson<{ mentors: { uid: string; name: string }[] }>(`/api/college/mentoring/college-students/mentors?department=${encodeURIComponent(department)}`)
      .then((d) => { if (!cancelled) setDeptMentors({ department, list: d.mentors }); })
      .catch(() => { if (!cancelled) setDeptMentors({ department, list: [] }); });
    return () => { cancelled = true; };
  }, [department]);
  const mentors = department === ANY ? allMentors : deptMentors?.department === department ? deptMentors.list : [];
  const ready = department !== ANY || !!mentorUid || term.length >= 3;

  // The college summary's numbers for the department / mentor picked (already loaded - no extra read).
  const stats = mentorUid ? byMentor.find((r) => r.key === mentorUid) : department !== ANY ? byDepartment.find((r) => r.key === department) : undefined;

  useEffect(() => {
    let cancelled = false;
    getJson<FinderOptions>("/api/college/mentoring/college-students/options")
      .then((d) => { if (!cancelled) setOptions(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  const years = useMemo(
    () => [...new Set((options?.sections ?? []).filter((s) => s.department === department).map((s) => s.year))].sort((a, b) => a - b),
    [options, department]
  );
  const sections = useMemo(
    () => [...new Set((options?.sections ?? []).filter((s) => s.department === department && (year === ANY || s.year === Number(year))).map((s) => s.name))].sort((a, b) => a.localeCompare(b)),
    [options, department, year]
  );

  const url = useCallback((cursor?: string) => {
    const p = new URLSearchParams();
    if (department !== ANY) p.set("department", department);
    if (year !== ANY) p.set("year", year);
    if (section !== ANY) p.set("section", section);
    if (mentorUid) p.set("mentorUid", mentorUid);

    if (term) p.set("q", term);
    if (cursor) p.set("cursor", cursor);
    return `/api/college/mentoring/college-students?${p}`;
  }, [department, year, section, mentorUid, term]);

  // A changed filter starts a new list (typing waits a moment so each keystroke is not a query).
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setState("loading");
      getJson<Page>(url())
        .then((d) => { if (!cancelled) { setRows(d.students); setNextCursor(d.nextCursor); setError(null); setState("done"); } })
        .catch((e: Error) => { if (!cancelled) { setError(e.message); setState("done"); } });
    }, term ? 300 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [ready, url, term]);

  async function loadMore() {
    if (!nextCursor) return;
    setState("loading");
    try {
      const d = await getJson<Page>(url(nextCursor));
      setRows((prev) => [...prev, ...d.students]);
      setNextCursor(d.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more");
    }
    setState("done");
  }

  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div>
          <h2 className="text-base font-semibold">Look up a student</h2>
          <p className="text-xs text-muted-foreground">
            Pick a department or a mentor to see their students (narrow by year, section, mentor or name), or type a Regd. No. Read-only; referrals, the health record and the mentor&apos;s private notes are not shown.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect label="Department" value={department} onChange={(v) => { setDepartment(v); setYear(ANY); setSection(ANY); setMentor(ANY); }}
            options={[{ value: ANY, label: "Choose a department" }, ...(options?.departments ?? []).map((d) => ({ value: d, label: d }))]} />
          <FilterSelect label="Year" value={year} disabled={department === ANY} onChange={(v) => { setYear(v); setSection(ANY); }}
            options={[{ value: ANY, label: "All years" }, ...years.map((y) => ({ value: String(y), label: `Year ${y}` }))]} />
          <FilterSelect label="Section" value={section} disabled={department === ANY} onChange={setSection}
            options={[{ value: ANY, label: "All sections" }, ...sections.map((n) => ({ value: n, label: n }))]} />
          <FilterSelect label="Mentor" value={mentor} onChange={setMentor}
            options={[{ value: ANY, label: "All mentors" }, ...mentors.map((m) => ({ value: `uid:${m.uid}`, label: nameFor("mentoring", { uid: m.uid }, m.name) }))]} />
          <div className="min-w-[12rem] flex-1 max-w-xs">
            <label className="text-xs text-muted-foreground mb-1 block">{department === ANY ? "Regd. No" : "Name or Regd. No (optional)"}</label>
            <Input className="h-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={department === ANY ? "e.g. 22A91A05" : "Narrow the list"} />
          </div>
        </div>

        {stats && (
          <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
            <strong>{stats.label}</strong>: {stats.students} student{stats.students === 1 ? "" : "s"} · {stats.mentored} with a mentor · {stats.metRecently} met recently · {stats.openActions} open action{stats.openActions === 1 ? "" : "s"} · {stats.openEscalations} open referral{stats.openEscalations === 1 ? "" : "s"}
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!ready && <p className="text-sm text-muted-foreground">Choose a department or a mentor, or type at least 3 characters of a Regd. No.</p>}
        {ready && state === "loading" && rows.length === 0 && <p className="text-sm text-muted-foreground">Loading…</p>}
        {ready && state === "done" && rows.length === 0 && !error && <p className="text-sm text-muted-foreground">No student matches these filters.</p>}
        {ready && rows.length > 0 && (
          <>
            <ul className="divide-y rounded-lg border">
              {rows.map((s) => (
                <li key={s.id}>
                  <Link href={`/principal/mentoring/${s.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm hover:bg-muted/50">
                    <span className="min-w-0">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-muted-foreground"> · {s.rollNumber || "No Regd. No"}</span>
                      <span className="block text-xs text-muted-foreground">{[s.department, `Year ${s.year}`, s.section && `Section ${s.section}`].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{s.mentorName ? `Mentor: ${nameFor("mentoring", { uid: s.mentorUid }, s.mentorName)}` : "No mentor"}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{rows.length} shown{nextCursor ? " · more available" : ""}</span>
              {nextCursor && <Button size="sm" variant="outline" disabled={state === "loading"} onClick={loadMore}>{state === "loading" ? "Loading…" : "Load more"}</Button>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
