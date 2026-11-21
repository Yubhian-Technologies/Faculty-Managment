// "Sync with Final List" - pure. The college's final students list for one year (Branch, Regd. No, Name, Type, M/F,
// Section - e.g. "2026-27 I B.TECH I SEM STUDENTS LIST") compared with the students the app holds for that year.
//
// PEOPLE ARE MATCHED BY WHO THEY ARE, NOT BY THEIR NUMBER: colleges renumber a year after students join and leave
// (VIT 2026: GUNTI MOUNIKA left CS&BS and everyone after her moved down one number), so the same Regd. No can belong to
// a different person in the list. Order: Hall Ticket No, then the same name within the branch, then a very close
// spelling (flagged). A name that is only somewhat close is never matched - it is shown to be checked by hand.
//   rollChanges - same person, new Regd. No                -> renumbered together (students/renumber)
//   new         - in the list, nobody in the app           -> added in the listed section (the Excel import)
//   moved       - same person, another / no section        -> moved (the HOD / Principal move)
//   missing     - in the app, not in the list              -> marked Discontinued (history kept), only when ticked;
//                 `numberReused` = the list gives their number to someone else (it is moved off them)
//   changed     - same person, name / gender / type differ -> corrected (the Office edit)
//   problems    - rows that can't be applied (unknown branch / section, branch change, possible same person ...)
// Nothing here writes anything.

export interface SyncDepartment { name: string; code?: string }
export interface SyncSection { id: string; name: string; department: string; courseId?: string; courseName?: string }
export interface SyncStudent {
  id: string; rollNumber?: string; name: string; gender?: string; admissionType?: string;
  department: string; section?: string; status?: string; courseId?: string; hallTicketNo?: string;
}
export interface SyncRow {
  line: number; branch: string; roll: string; name: string; type?: string; gender?: string; section: string;
  hallTicket?: string; rank?: string;
}

export interface NewStudent { line: number; roll: string; name: string; department: string; sectionId: string; section: string; courseName?: string; gender?: string; admissionType?: string; hallTicket?: string; rank?: string }
export interface MovedStudent { studentId: string; roll: string; name: string; department: string; from: string; toSectionId: string; to: string }
export interface MissingStudent { studentId: string; roll: string; name: string; department: string; section: string; noRoll?: boolean; numberReused?: boolean }
export interface RollChange { studentId: string; name: string; department: string; from: string; to: string; matchedBy: "hallTicket" | "name" | "closeName"; listName: string }
export interface ChangedField { studentId: string; roll: string; name: string; field: "name" | "gender" | "admissionType"; label: string; from: string; to: string }
export interface SyncProblem { line: number; roll: string; message: string }
export interface BranchMatch { branch: string; department: string | null; rows: number }

export interface SyncPlan {
  branches: BranchMatch[];
  unchanged: number;
  rollChanges: RollChange[];
  added: NewStudent[];
  moved: MovedStudent[];
  missing: MissingStudent[];
  changed: ChangedField[];
  problems: SyncProblem[];
}

export const rollKey = (s: string | undefined) => String(s ?? "").toUpperCase().replace(/[\s-]+/g, "");
const norm = (s: string | undefined) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const squash = (s: string | undefined) => String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim();

/** M / F / Male / Female -> the roster's Gender values. */
export function genderOf(v: string | undefined): string {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "M" || s === "MALE" || s === "BOY") return "Male";
  if (s === "F" || s === "FEMALE" || s === "GIRL") return "Female";
  if (s === "O" || s === "OTHER") return "Other";
  return "";
}

/** The list's admission TYPE -> the roster's Admission Type wording (CONV = Convenor, CAT-B = Management, SPOT). */
export function admissionTypeOf(v: string | undefined): string {
  const s = norm(v);
  if (!s) return "";
  if (s.startsWith("CONV")) return "Convenor";
  if (s === "CATB" || s.startsWith("MANAG") || s === "MQ" || s === "NRI") return "Management";
  if (s.startsWith("SPOT")) return "Spot Admission";
  if (s.startsWith("LATERAL") || s === "LE") return "Lateral Entry";
  return String(v).trim();
}

/** The section prefix before its letter ("AIML-B" -> "AIML"). */
const sectionPrefix = (name: string) => norm(name.replace(/[-\s]*[A-Z0-9]$/i, ""));

/** Which department a list's Branch means: its code, its sections' prefix, or the start of its name. */
export function matchBranch(branch: string, departments: SyncDepartment[], sections: SyncSection[]): string | null {
  const t = norm(branch);
  if (!t) return null;
  const withSections = new Set(sections.map((s) => s.department));
  const pool = departments.filter((d) => withSections.has(d.name));
  const one = (list: SyncDepartment[]) => (list.length === 1 ? list[0].name : null);
  return one(pool.filter((d) => norm(d.code) === t || norm(d.name) === t))
    ?? one(pool.filter((d) => sections.some((s) => s.department === d.name && sectionPrefix(s.name) === t)))
    ?? one(pool.filter((d) => norm(d.name).startsWith(t) || squash(d.name).split(" ")[0].startsWith(t)));
}

/** The department's section for the list's letter ("A" -> "CSE-A" / "A"). */
export function matchSection(department: string, letter: string, sections: SyncSection[]): SyncSection | null {
  const l = norm(letter);
  if (!l) return null;
  const mine = sections.filter((s) => s.department === department);
  const hits = mine.filter((s) => {
    const n = squash(s.name);
    return norm(n) === l || n.endsWith(`-${l}`) || n.endsWith(` ${l}`);
  });
  return hits.length === 1 ? hits[0] : null;
}

/** How alike two names are, 0..1: the words compared in order (edit distance) and as a set; spacing / case ignored. */
export function nameSimilarity(a: string, b: string): number {
  const x = squash(a), y = squash(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const sorted = (s: string) => s.split(" ").sort().join(" ");
  const lev = (p: string, q: string) => {
    const d = Array.from({ length: q.length + 1 }, (_, j) => j);
    for (let i = 1; i <= p.length; i++) {
      let prev = d[0]; d[0] = i;
      for (let j = 1; j <= q.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (p[i - 1] === q[j - 1] ? 0 : 1)); prev = t; }
    }
    return d[q.length];
  };
  const ratio = (p: string, q: string) => 1 - lev(p, q) / Math.max(p.length, q.length);
  // Word by word, for names written with initials ("L CHANDRA SEKHAR" ~ "LAKSHMIPATHULA CHANDRA SHEKAR"): every word of
  // the shorter name must meet a word of the longer one - the same word, a close spelling, or its initial. Capped
  // below the automatic-match level, so such a pair is only ever flagged for a person to check.
  const [short, long] = [x.split(" "), y.split(" ")].sort((a, b) => a.length - b.length);
  const used = new Set<number>();
  let met = 0;
  for (const w of short) {
    const i = long.findIndex((v, k) => !used.has(k) && (v === w || (w.length === 1 && v.startsWith(w)) || (v.length === 1 && w.startsWith(v)) || ratio(v, w) >= 0.6));
    if (i >= 0) { used.add(i); met += 1; }
  }
  const words = short.length >= 2 ? 0.84 * (met / short.length) : 0;
  return Math.max(ratio(x, y), ratio(sorted(x), sorted(y)), words);
}

const CLOSE = 0.88;   // matched automatically, flagged "close spelling"
const MAYBE = 0.7;    // not matched: shown as "possibly the same person - check"
const digits = (s: string | undefined) => String(s ?? "").replace(/\D/g, "");

export function planFinalListSync(input: {
  departments: SyncDepartment[];
  /** The year's sections (of the course being synced). */
  sections: SyncSection[];
  /** Every student of the college in that year (any department / status) - the comparison's other side. */
  students: SyncStudent[];
  rows: SyncRow[];
  /** The office's own choice for a Branch value the automatic match couldn't place. */
  branchMap?: Record<string, string>;
  /** Regd. No (rollKey) -> "Year 2" etc.: students of OTHER years holding a listed number. */
  otherYearRolls?: Map<string, string>;
}): SyncPlan {
  const { departments, sections, students, rows } = input;
  const problems: SyncProblem[] = [];
  const branchOf = new Map<string, string | null>();
  const branchRows = new Map<string, number>();
  for (const r of rows) {
    const b = r.branch.trim();
    branchRows.set(b, (branchRows.get(b) ?? 0) + 1);
    if (!branchOf.has(b)) {
      const chosen = input.branchMap?.[b];
      branchOf.set(b, chosen && departments.some((d) => d.name === chosen) ? chosen : matchBranch(b, departments, sections));
    }
  }
  const mapped = new Set([...branchOf.values()].filter((d): d is string => !!d));
  const courseIds = new Set(sections.filter((s) => mapped.has(s.department)).map((s) => s.courseId).filter(Boolean));
  const live = (s: SyncStudent) => s.status !== "DISCONTINUED" && s.status !== "GRADUATED";
  const inScope = (s: SyncStudent) => live(s) && mapped.has(s.department) && (!s.courseId || courseIds.size === 0 || courseIds.has(s.courseId));

  // ── Valid rows (branch + section known, Regd. No given once) ──
  type Row = SyncRow & { department: string; sec: SyncSection; key: string };
  const valid: Row[] = [];
  const seenRoll = new Set<string>();
  for (const r of rows) {
    const key = rollKey(r.roll);
    if (!key) continue;
    if (seenRoll.has(key)) { problems.push({ line: r.line, roll: r.roll, message: "Listed twice in the file" }); continue; }
    seenRoll.add(key);
    const department = branchOf.get(r.branch.trim());
    if (!department) { problems.push({ line: r.line, roll: r.roll, message: `Branch "${r.branch}" isn't matched to a department - choose it above` }); continue; }
    const sec = matchSection(department, r.section, sections);
    if (!sec) { problems.push({ line: r.line, roll: r.roll, message: `${department} has no section "${r.section}" in this year - create it first` }); continue; }
    valid.push({ ...r, department, sec, key });
  }

  // ── Match each row to a person (each app student at most once) ──
  const pool = students.filter(live);
  const taken = new Set<string>();
  const match = new Map<Row, { s: SyncStudent; by: RollChange["matchedBy"] }>();
  const byHall = new Map<string, SyncStudent[]>();
  for (const s of pool) { const h = digits(s.hallTicketNo); if (h.length >= 6) byHall.set(h, [...(byHall.get(h) ?? []), s]); }
  for (const r of valid) {                                            // 1. Hall Ticket No
    const h = digits(r.hallTicket);
    const hits = h.length >= 6 ? (byHall.get(h) ?? []).filter((s) => !taken.has(s.id)) : [];
    if (hits.length === 1) { match.set(r, { s: hits[0], by: "hallTicket" }); taken.add(hits[0].id); }
  }
  for (const r of valid) {                                            // 2. the same name in the branch (the Regd. No breaks a tie)
    if (match.has(r)) continue;
    const hits = pool.filter((s) => !taken.has(s.id) && s.department === r.department && squash(s.name) === squash(r.name));
    const pick = hits.length === 1 ? hits[0] : hits.find((s) => rollKey(s.rollNumber) === r.key);
    if (pick) { match.set(r, { s: pick, by: "name" }); taken.add(pick.id); }
  }
  const maybe: { r: Row; s: SyncStudent; score: number }[] = [];
  for (const r of valid) {                                            // 3. a very close spelling in the branch
    if (match.has(r)) continue;
    const scored = pool.filter((s) => !taken.has(s.id) && s.department === r.department)
      .map((s) => ({ s, score: nameSimilarity(s.name, r.name) + (rollKey(s.rollNumber) === r.key ? 0.02 : 0) }))
      .sort((a, b) => b.score - a.score);
    const [best, second] = scored;
    if (best && best.score >= CLOSE && (!second || best.score - second.score >= 0.05)) { match.set(r, { s: best.s, by: "closeName" }); taken.add(best.s.id); }
    else if (best && best.score >= MAYBE) maybe.push({ r, s: best.s, score: best.score });
  }
  const maybeStudents = new Set<string>();
  for (const m of maybe) {
    if (taken.has(m.s.id)) continue;
    maybeStudents.add(m.s.id);
    problems.push({ line: m.r.line, roll: m.r.roll, message: `"${m.r.name}" may be ${m.s.name} (${m.s.rollNumber || "no Regd. No"}, ${m.s.section || "Unassigned"}) - correct the spelling in the file or the app and compare again` });
  }

  // ── What changes for each person ──
  const added: NewStudent[] = [];
  const moved: MovedStudent[] = [];
  const changed: ChangedField[] = [];
  const rollChanges: RollChange[] = [];
  let unchanged = 0;
  const byRollKey = new Map<string, SyncStudent[]>();
  for (const s of students) { const k = rollKey(s.rollNumber); if (k) byRollKey.set(k, [...(byRollKey.get(k) ?? []), s]); }

  for (const r of valid) {
    const m = match.get(r);
    if (!m) {
      if (maybe.some((x) => x.r === r && !taken.has(x.s.id))) continue;  // reported above; not added until checked
      // The same person under another branch in the app: a branch change, never a second record.
      const elsewhere = pool.find((s) => !taken.has(s.id) && s.department !== r.department && squash(s.name) === squash(r.name));
      if (elsewhere) {
        problems.push({ line: r.line, roll: r.roll, message: `${elsewhere.name} is in the app under ${elsewhere.department}${elsewhere.section ? ` (${elsewhere.section})` : ""}, listed under ${r.department} - a branch change; move them by hand` });
        taken.add(elsewhere.id); // not "left" either
        continue;
      }
      const other = input.otherYearRolls?.get(r.key);
      if (other) { problems.push({ line: r.line, roll: r.roll, message: `This Regd. No belongs to a ${other} student` }); continue; }
      if ((byRollKey.get(r.key) ?? []).some((h) => h.status === "DISCONTINUED")) {
        problems.push({ line: r.line, roll: r.roll, message: "This Regd. No belongs to a student marked Discontinued - the Principal can reinstate them, or correct the number" });
        continue;
      }
      added.push({
        line: r.line, roll: r.roll.trim(), name: r.name.trim(), department: r.department, sectionId: r.sec.id, section: r.sec.name, courseName: r.sec.courseName,
        gender: genderOf(r.gender) || undefined, admissionType: admissionTypeOf(r.type) || undefined,
        hallTicket: r.hallTicket?.trim() || undefined, rank: r.rank?.trim() || undefined,
      });
      continue;
    }
    const s = m.s;
    if (s.department !== r.department) {
      problems.push({ line: r.line, roll: r.roll, message: `${s.name} is in the app under ${s.department}${s.section ? ` (${s.section})` : ""}, listed under ${r.department} - a branch change; move them by hand` });
      continue;
    }
    let same = true;
    if (rollKey(s.rollNumber) !== r.key) {
      rollChanges.push({ studentId: s.id, name: s.name, department: s.department, from: s.rollNumber || "(none)", to: r.roll.trim(), matchedBy: m.by, listName: r.name.trim() });
      same = false;
    }
    if ((s.section ?? "") !== r.sec.name) {
      moved.push({ studentId: s.id, roll: r.roll.trim(), name: s.name, department: s.department, from: s.section || "Unassigned", toSectionId: r.sec.id, to: r.sec.name });
      same = false;
    }
    const diffs: [ChangedField["field"], string, string, string][] = [
      ["name", "Name", s.name, r.name.trim()],
      ["gender", "Gender", s.gender ?? "", genderOf(r.gender)],
      ["admissionType", "Admission Type", s.admissionType ?? "", admissionTypeOf(r.type)],
    ];
    for (const [field, label, from, to] of diffs) {
      if (!to || squash(from) === squash(to)) continue;
      changed.push({ studentId: s.id, roll: r.roll.trim(), name: s.name, field, label, from: from || "-", to });
      same = false;
    }
    if (same) unchanged += 1;
  }

  // Numbers the list gives to someone: a student who keeps one of them in the app has to give it up.
  const wantedRolls = new Set([...rollChanges.map((c) => rollKey(c.to)), ...added.map((a) => rollKey(a.roll))]);
  const missing: MissingStudent[] = students
    .filter((s) => inScope(s) && !taken.has(s.id) && !maybeStudents.has(s.id))
    .map((s) => ({
      studentId: s.id, roll: s.rollNumber ?? "", name: s.name, department: s.department, section: s.section || "Unassigned",
      ...(rollKey(s.rollNumber) ? {} : { noRoll: true }),
      ...(wantedRolls.has(rollKey(s.rollNumber)) ? { numberReused: true } : {}),
    }))
    .sort((a, b) => a.department.localeCompare(b.department) || a.roll.localeCompare(b.roll));

  return {
    branches: [...branchOf].map(([branch, department]) => ({ branch, department, rows: branchRows.get(branch) ?? 0 })),
    unchanged, rollChanges, added, moved, missing, changed, problems,
  };
}
