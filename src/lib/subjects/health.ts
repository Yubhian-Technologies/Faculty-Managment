import { normalizeSubjectCode, normalizeSubjectName } from "./subjectIdentity";

// The Academics data-health check: problems in the curriculum that nobody has noticed yet. Pure, so
// the route that reads Firestore and the tests share one rulebook.

export type HealthSeverity = "error" | "warning" | "info";
export interface HealthIssue {
  code:
    | "COURSE_NO_REGULATION" | "YEAR_NO_SEMESTERS" | "SUBJECT_UNSCOPED" | "DUPLICATE_CODE" | "DUPLICATE_NAME"
    | "INSTANCE_DRIFT" | "SUBJECT_NOT_ASSIGNED";
  severity: HealthSeverity;
  title: string;
  count: number;
  /** A few examples, capped. */
  items: string[];
}

export interface HealthInput {
  catalog: { id: string; name: string; regulations?: string[]; isActive?: boolean }[];
  courses: { id: string; name: string; departmentName?: string; catalogId?: string; durationYears?: number; isActive?: boolean }[];
  /** courseId -> years that have at least one semester configured. */
  yearsWithSemesters: Map<string, Set<number>>;
  subjects: { id: string; code?: string; name?: string; courseId?: string; catalogId?: string; regulation?: string; isActive?: boolean }[];
  instances: { id: string; subjectId: string; subjectCode?: string; subjectName?: string; regulation?: string; isActive?: boolean }[];
}

const EXAMPLES = 15;
const cap = (items: string[]) => items.slice(0, EXAMPLES);

export function computeAcademicsHealth(input: HealthInput): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const push = (code: HealthIssue["code"], severity: HealthSeverity, title: string, items: string[]) => {
    if (items.length > 0) issues.push({ code, severity, title, count: items.length, items: cap(items) });
  };

  push("COURSE_NO_REGULATION", "error", "Courses with no regulation in the Course Catalog (subjects can't be added or assigned)",
    input.catalog.filter((c) => c.isActive !== false && (c.regulations ?? []).length === 0).map((c) => c.name));

  const missing: string[] = [];
  for (const c of input.courses.filter((x) => x.isActive !== false)) {
    const have = input.yearsWithSemesters.get(c.id) ?? new Set<number>();
    const years = Array.from({ length: Math.max(0, Number(c.durationYears) || 0) }, (_, i) => i + 1).filter((y) => !have.has(y));
    if (years.length > 0) missing.push(`${c.name}${c.departmentName ? ` (${c.departmentName})` : ""}: year${years.length > 1 ? "s" : ""} ${years.join(", ")}`);
  }
  push("YEAR_NO_SEMESTERS", "warning", "Course years with no semesters configured in Course-Year Timings (nothing can be assigned to them)", missing);

  const scopeOf = new Map(input.courses.map((c) => [c.id, c.catalogId || c.id]));
  const masters = input.subjects.filter((s) => s.courseId);
  const unscoped: string[] = [];
  const groups = new Map<string, typeof masters>();
  for (const s of masters) {
    const regulation = (s.regulation ?? "").trim();
    const scope = s.catalogId || scopeOf.get(s.courseId!);
    if (!regulation || !scope) { unscoped.push(`${s.code ?? s.id}: ${!regulation ? "no regulation" : "course not found"}`); continue; }
    const key = `${scope}|${regulation}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  push("SUBJECT_UNSCOPED", "error", "Subjects with no regulation or no course (they can't be identified or assigned)", unscoped);

  const dupes: Record<"DUPLICATE_CODE" | "DUPLICATE_NAME", string[]> = { DUPLICATE_CODE: [], DUPLICATE_NAME: [] };
  for (const [key, list] of groups) {
    const regulation = key.slice(key.indexOf("|") + 1);
    const scan = (code: keyof typeof dupes, value: (s: (typeof list)[number]) => string, label: (v: string) => string) => {
      const seen = new Map<string, string[]>();
      for (const s of list) { const v = value(s); if (v) seen.set(v, [...(seen.get(v) ?? []), s.code ?? s.id]); }
      for (const [v, codes] of seen) if (codes.length > 1) dupes[code].push(`${label(v)} · ${regulation}: ${codes.join(", ")}`);
    };
    scan("DUPLICATE_CODE", (s) => normalizeSubjectCode(s.code), (v) => `Code ${v}`);
    scan("DUPLICATE_NAME", (s) => normalizeSubjectName(s.name), (v) => `Name "${v}"`);
  }
  push("DUPLICATE_CODE", "error", "Subjects sharing a code within a course and regulation (the Exam Cell can't tell them apart)", dupes.DUPLICATE_CODE);
  push("DUPLICATE_NAME", "error", "Subjects sharing a name within a course and regulation", dupes.DUPLICATE_NAME);

  const masterById = new Map(input.subjects.map((s) => [s.id, s]));
  const drift: string[] = [];
  const assigned = new Set<string>();
  for (const i of input.instances.filter((x) => x.isActive !== false)) {
    assigned.add(i.subjectId);
    const m = masterById.get(i.subjectId);
    const label = `${i.subjectCode ?? i.id}`;
    if (!m) drift.push(`${label}: its subject no longer exists`);
    else if (m.isActive === false) drift.push(`${label}: its subject is deactivated`);
    else if (normalizeSubjectCode(m.code) !== normalizeSubjectCode(i.subjectCode)) drift.push(`${label}: master code is ${m.code}`);
    else if (normalizeSubjectName(m.name) !== normalizeSubjectName(i.subjectName)) drift.push(`${label}: name differs from the master`);
    else if ((m.regulation ?? "").trim() !== (i.regulation ?? "").trim()) drift.push(`${label}: regulation is ${i.regulation || "empty"}, master is ${m.regulation || "empty"}`);
  }
  push("INSTANCE_DRIFT", "error", "Semester subjects that no longer match their master subject", drift);

  push("SUBJECT_NOT_ASSIGNED", "info", "Subjects not assigned to any department's semester yet",
    masters.filter((s) => s.isActive !== false && !assigned.has(s.id)).map((s) => `${s.code ?? s.id} - ${s.name ?? ""} (${s.regulation || "no regulation"})`));

  const rank: Record<HealthSeverity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
