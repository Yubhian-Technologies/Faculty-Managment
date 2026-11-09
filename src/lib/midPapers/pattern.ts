import type { MidOutcomeSwitches } from "@/types/examMidSchedule";
import type { BloomLevel } from "@/types/midQuestionBank";
import type { MidPaperPattern, MidPaperQuestion, PaperChoice, PaperPartDef, PaperPartKind, PaperSetProgress, PaperSubPart } from "@/types/midPaperSet";
import { BLOOM_LEVELS, LIMITS, MID_IMAGE_URL_PREFIX } from "@/lib/midBank/constants";
import { ALL_OUTCOMES_ON } from "@/lib/midBank/outcomeSwitches";

// Question paper patterns (the Exam Cell's, per course + regulation) and the checks a faculty member's question
// against its part must pass. Pure - the editor's live hints and the server's save share it.

export const PART_KINDS: { value: PaperPartKind; label: string; hint: string }[] = [
  { value: "MCQ", label: "Choose the correct answer", hint: "Options (a), (b) ... with the right one marked" },
  { value: "FILL_BLANK", label: "Fill in the blanks", hint: "A sentence with a blank and its answer" },
  { value: "SHORT", label: "Short answer", hint: "A short question" },
  { value: "DESCRIPTIVE", label: "Descriptive", hint: "A long question, optionally in parts (a), (b) ..." },
];
export const kindLabel = (k: PaperPartKind) => PART_KINDS.find((x) => x.value === k)?.label ?? k;
/** Objective parts are entered as one total; short / descriptive question by question. */
export const marksPerQuestion = (k: PaperPartKind) => k === "SHORT" || k === "DESCRIPTIVE";
const isObjective = (k: PaperPartKind) => k === "MCQ" || k === "FILL_BLANK";

/** How many of a (fixed) part's questions a student answers. */
export function answeredCount(p: Pick<PaperPartDef, "questions" | "choice">): number {
  if (p.choice.kind === "ANY") return Math.min(p.questions, p.choice.answer);
  if (p.choice.kind === "OR_PAIRS") return Math.floor(p.questions / 2);
  return p.questions;
}
export const partMax = (p: Pick<PaperPartDef, "questions" | "choice" | "marksEach"> & Partial<Pick<PaperPartDef, "flexible" | "maxMarks">>) =>
  p.flexible ? p.maxMarks ?? 0 : answeredCount(p) * p.marksEach;
export const patternMax = (pat: Pick<MidPaperPattern, "parts">) => pat.parts.reduce((n, p) => n + partMax(p), 0);

/** What a part counts for in marks entry: a per-unit part its fixed max (the raw total scales to it), else its max. */
export const countedMax = (p: PaperPartDef) => (p.perUnit && !p.flexible ? p.maxMarks ?? 0 : partMax(p));
/** Does the pattern set a part per unit (so a paper needs the subject's Mid units)? */
export const needsUnits = (pat: Pick<MidPaperPattern, "parts">) => pat.parts.some((p) => !p.flexible && !!p.perUnit);

/**
 * Each question's unit for a per-unit part: `perUnit` questions per unit of the Mid; a unit another Mid of the subject
 * also covers (a "half" unit, e.g. 2½ units per Mid) gets half of them, rounded up - except with OR pairs, where it
 * keeps a full pair. 5-unit subject, 2 per unit, Mid 1 = 1, 2, 3 / Mid 2 = 3, 4, 5: Mid 1 = 1, 1, 2, 2, 3.
 */
export function unitLayout(p: Pick<PaperPartDef, "perUnit" | "choice">, units: number[], shared: number[] = []): number[] {
  const per = p.perUnit ?? 0;
  const half = new Set(shared);
  return units.flatMap((u) => Array.from({ length: half.has(u) && p.choice.kind !== "OR_PAIRS" ? Math.ceil(per / 2) : per }, () => u));
}

/** A started paper's copy of the pattern: each per-unit part gets its questions laid out unit by unit. */
export function expandPattern<P extends Pick<MidPaperPattern, "parts">>(pat: P, units: number[], shared: number[] = []): P {
  return { ...pat, parts: pat.parts.map((p) => {
    if (!p.perUnit || p.flexible) return p;
    const layout = unitLayout(p, units, shared);
    return { ...p, questions: layout.length, unitLayout: layout };
  }) };
}
/** The unit a per-unit part's question is for (its laid-out order; older copies: `perUnit` per unit). */
export const unitOfQuestion = (p: Pick<PaperPartDef, "perUnit" | "unitLayout">, units: number[], no: number): number | undefined =>
  p.unitLayout ? p.unitLayout[no - 1] : p.perUnit ? units[Math.floor((no - 1) / p.perUnit)] : undefined;
export function choiceText(p: Pick<PaperPartDef, "questions" | "choice"> & Partial<Pick<PaperPartDef, "flexible">>, written?: number): string {
  const n = p.flexible ? written : p.questions;
  if (p.choice.kind === "ANY") return n ? `Answer any ${p.choice.answer} of the ${n} questions` : `Answer any ${p.choice.answer} questions`;
  if (p.choice.kind === "OR_PAIRS") return "Answer one question from each pair";
  return "Answer all questions";
}
/** Questions of the fixed parts (a faculty-decides part has as many as the faculty writes). */
export const questionCount = (pat: Pick<MidPaperPattern, "parts">) => pat.parts.reduce((n, p) => n + (p.flexible ? 0 : p.questions), 0);
/** Most questions a faculty-decides part may hold. */
export const FLEXIBLE_MAX_QUESTIONS = 40;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.floor(Number(v)) : NaN);

export function cleanPattern(raw: unknown): { value: Pick<MidPaperPattern, "setsPerFaculty" | "durationMinutes" | "instruction" | "regdBoxes" | "parts">; errors: string[] } {
  const r = (raw ?? {}) as Partial<MidPaperPattern>;
  const errors: string[] = [];
  const setsPerFaculty = int(r.setsPerFaculty);
  if (!(setsPerFaculty >= 1 && setsPerFaculty <= 5)) errors.push("Question papers per faculty must be 1 to 5");
  const durationMinutes = int(r.durationMinutes);
  if (!(durationMinutes >= 15 && durationMinutes <= 360)) errors.push("Duration must be 15 to 360 minutes");
  const regdBoxes = Number.isFinite(int(r.regdBoxes)) ? Math.max(6, Math.min(20, int(r.regdBoxes))) : 12;
  const list = Array.isArray(r.parts) ? r.parts : [];
  if (list.length === 0) errors.push("Add at least one part");
  if (list.length > 6) errors.push("At most 6 parts");
  const parts: PaperPartDef[] = list.slice(0, 6).map((raw, i) => {
    const p = (raw ?? {}) as Partial<PaperPartDef>;
    const id = String.fromCharCode(65 + i);
    const label = str(p.label, 40) || `Part ${id}`;
    if (p.flexible) {
      // Faculty decide the questions: only the max marks and which ones are answered are fixed here.
      const maxMarks = int(p.maxMarks);
      if (!(maxMarks >= 1 && maxMarks <= 200)) errors.push(`${label}: max marks must be a whole number from 1 to 200`);
      const c = (p.choice ?? { kind: "ALL" }) as PaperChoice;
      let choice: PaperChoice = { kind: "ALL" };
      if (c.kind === "ANY") {
        const answer = int((c as { answer?: unknown }).answer);
        if (!(answer >= 1 && answer <= 20)) errors.push(`${label}: "answer any" needs how many (1 to 20)`);
        else if (maxMarks % answer !== 0) errors.push(`${label}: with "answer any ${answer}", the max marks must divide by ${answer} (every question carries the same marks)`);
        choice = { kind: "ANY", answer: answer || 1 };
      } else if (c.kind === "OR_PAIRS") choice = { kind: "OR_PAIRS" };
      return { id, label, title: str(p.title, 120) || label, flexible: true, maxMarks: maxMarks || 1, kind: "DESCRIPTIVE" as PaperPartKind, questions: 0, marksEach: 0, choice };
    }
    const kind: PaperPartKind = PART_KINDS.some((k) => k.value === p.kind) ? (p.kind as PaperPartKind) : "DESCRIPTIVE";
    // Per unit: the number of questions follows the subject's Mid units; the part counts for its own max.
    const perUnit = p.perUnit ? int(p.perUnit) : 0;
    const questions = perUnit ? 0 : int(p.questions);
    const marksEach = Number(p.marksEach);
    if (perUnit) {
      if (!(perUnit >= 1 && perUnit <= 4)) errors.push(`${label}: 1 to 4 questions per unit`);
      const max = int(p.maxMarks);
      if (!(max >= 1 && max <= 200)) errors.push(`${label}: the marks it counts for must be a whole number from 1 to 200`);
      if (p.choice?.kind === "OR_PAIRS" && perUnit % 2 !== 0) errors.push(`${label}: OR pairs need an even number of questions per unit`);
    } else if (!(questions >= 1 && questions <= 40)) errors.push(`${label}: 1 to 40 questions`);
    if (!(marksEach > 0 && marksEach <= 100) || Math.round(marksEach * 2) !== marksEach * 2) errors.push(`${label}: marks per question must be 0.5 to 100 (in halves)`);
    const c = (p.choice ?? { kind: "ALL" }) as PaperChoice;
    let choice: PaperChoice = { kind: "ALL" };
    if (c.kind === "ANY") {
      const answer = int((c as { answer?: unknown }).answer);
      if (!(answer >= 1 && (perUnit ? answer <= 40 : answer < questions))) errors.push(`${label}: "answer any" must be fewer than the number of questions`);
      choice = { kind: "ANY", answer: answer || 1 };
    } else if (c.kind === "OR_PAIRS") {
      if (!perUnit && questions % 2 !== 0) errors.push(`${label}: OR pairs need an even number of questions`);
      choice = { kind: "OR_PAIRS" };
    }
    const options = kind === "MCQ" ? Math.max(2, Math.min(6, int(p.options) || 4)) : undefined;
    const maxSubParts = kind === "DESCRIPTIVE" ? Math.max(1, Math.min(5, int(p.maxSubParts) || 1)) : undefined;
    return {
      id, label, title: str(p.title, 120) || kindLabel(kind), kind, questions: perUnit ? 0 : questions || 1, marksEach: marksEach || 1, choice,
      ...(options ? { options } : {}), ...(maxSubParts ? { maxSubParts } : {}),
      ...(perUnit ? { perUnit, maxMarks: int(p.maxMarks) || 1 } : {}),
    };
  });
  return {
    value: { setsPerFaculty: setsPerFaculty || 1, durationMinutes: durationMinutes || 90, instruction: str(r.instruction, 300), regdBoxes, parts },
    errors,
  };
}

export const questionId = (set: number, partId: string, no: number) => `${set}_${partId}_${no}`;

/** The papers a paper set writes: its own share when the HOD shared the papers (`sets`), else 1..setsPerFaculty. */
export function setNumbers(pat: Pick<MidPaperPattern, "setsPerFaculty"> & { sets?: number[] }): number[] {
  const all = Array.from({ length: Math.max(0, pat.setsPerFaculty) }, (_, i) => i + 1);
  const mine = (pat.sets ?? []).filter((n) => all.includes(n));
  return mine.length ? [...new Set(mine)].sort((a, b) => a - b) : all;
}

/**
 * The HOD sharing a subject's `total` papers among its setters: every paper has at least one setter, each setter at
 * least one paper (two setters may write the same paper - the Exam Cell picks among them). Returns the clean share or
 * the problems.
 */
export function checkSetShare(raw: unknown, facultyIds: string[], total: number, nameOf: (id: string) => string = (x) => x): { value: Record<string, number[]>; errors: string[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const value: Record<string, number[]> = {};
  const errors: string[] = [];
  const owner = new Map<number, string>();
  for (const f of facultyIds) {
    const sets = [...new Set((Array.isArray(r[f]) ? r[f] as unknown[] : []).map(Number).filter((n) => Number.isInteger(n)))].sort((a, b) => a - b);
    for (const n of sets) {
      if (n < 1 || n > total) { errors.push(`There is no Paper ${n} - the subject has ${total}`); continue; }
      owner.set(n, f);
    }
    if (sets.length === 0) errors.push(`Give ${nameOf(f)} at least one paper`);
    value[f] = sets.filter((n) => n >= 1 && n <= total);
  }
  for (let n = 1; n <= total; n++) if (!owner.has(n)) errors.push(`Paper ${n} has no setter`);
  return { value, errors: [...new Set(errors)] };
}

/** Every question slot of every set, in paper order. */
export function questionSlots(pat: Pick<MidPaperPattern, "parts" | "setsPerFaculty" | "sets">): { set: number; partId: string; no: number; id: string }[] {
  const out: { set: number; partId: string; no: number; id: string }[] = [];
  for (const set of setNumbers(pat)) for (const p of pat.parts) if (!p.flexible) for (let no = 1; no <= p.questions; no++) out.push({ set, partId: p.id, no, id: questionId(set, p.id, no) });
  return out;
}

const cleanText = (v: unknown) => String(v ?? "").slice(0, LIMITS.questionText);
const cleanImage = (v: { imageUrl?: unknown; imageCaption?: unknown }) => {
  const imageUrl = typeof v.imageUrl === "string" && v.imageUrl.startsWith(MID_IMAGE_URL_PREFIX) ? v.imageUrl : "";
  return imageUrl ? { imageUrl, imageCaption: str(v.imageCaption, LIMITS.imageCaption) } : {};
};

/**
 * The part as one question sees it: a fixed part as set; in a faculty-decides part the question's own kind and
 * marks (MCQ with as many options as written, 2-6; descriptive may split into up to 5 parts).
 */
export function partFor(part: PaperPartDef, q?: Partial<Pick<MidPaperQuestion, "kind" | "marks" | "options">> | null): PaperPartDef {
  if (!part.flexible) return part;
  const kind: PaperPartKind = PART_KINDS.some((k) => k.value === q?.kind) ? (q!.kind as PaperPartKind) : "SHORT";
  const marks = Number.isInteger(q?.marks) && (q!.marks as number) > 0 ? (q!.marks as number) : 1;
  return { ...part, kind, marksEach: marks, questions: 1, options: kind === "MCQ" ? Math.max(2, Math.min(6, q?.options?.length || 4)) : undefined, maxSubParts: kind === "DESCRIPTIVE" ? 5 : undefined };
}

/** A faculty-decides part's questions in one paper (1..n, in order). */
export const flexibleQuestions = <Q extends Pick<MidPaperQuestion, "set" | "partId" | "no">>(questions: Q[], set: number, partId: string) =>
  questions.filter((q) => q.set === set && q.partId === partId).sort((a, b) => a.no - b.no);

/** Why a faculty-decides part of one paper doesn't fit the Exam Cell's max marks and choice yet ("" = it fits). */
export function flexibleProblem(part: PaperPartDef, qs: Pick<MidPaperQuestion, "marks">[]): string {
  const max = part.maxMarks ?? 0;
  const m = qs.map((q) => (Number.isInteger(q.marks) ? (q.marks as number) : 0));
  if (m.length === 0) return `${part.label}: add questions (${max} marks)`;
  if (m.length > FLEXIBLE_MAX_QUESTIONS) return `${part.label}: at most ${FLEXIBLE_MAX_QUESTIONS} questions`;
  if (part.choice.kind === "ANY") {
    const k = part.choice.answer, each = max / k;
    if (m.length <= k) return `${part.label}: students answer any ${k}, so write more than ${k} questions (now ${m.length})`;
    const off = m.findIndex((x) => x !== each);
    return off >= 0 ? `${part.label}: every question carries ${each} marks (students answer any ${k}) - question ${off + 1} has ${m[off]}` : "";
  }
  if (part.choice.kind === "OR_PAIRS") {
    if (m.length % 2 !== 0) return `${part.label}: questions go in OR pairs - add one more question (now ${m.length})`;
    for (let i = 0; i < m.length; i += 2) if (m[i] !== m[i + 1]) return `${part.label}: questions ${i + 1} and ${i + 2} are an OR pair and must carry the same marks`;
    const sum = m.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
    return sum === max ? "" : `${part.label}: one question of each pair adds up to ${sum} of ${max} marks`;
  }
  const sum = m.reduce((a, b) => a + b, 0);
  return sum === max ? "" : `${part.label}: questions add up to ${sum} of ${max} marks`;
}

/** Shape a question as the editor sent it, for its part (drafts keep whatever is the right shape). */
export function cleanPaperQuestion(raw: unknown, setPart: PaperPartDef, coIds: Set<string>, bloomIds: BloomLevel[] = BLOOM_LEVELS): Pick<MidPaperQuestion, "text" | "imageUrl" | "imageCaption" | "options" | "answer" | "subParts" | "cos" | "bloom" | "unit" | "kind" | "marks"> {
  const r = (raw ?? {}) as Partial<MidPaperQuestion>;
  const part = partFor(setPart, r);
  const cos = Array.isArray(r.cos) ? [...new Set(r.cos.map(String).filter((c) => coIds.has(c)))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))) : [];
  // Only the paper set's Bloom's levels (the college's list when it started).
  const bloom = bloomIds.includes(r.bloom as BloomLevel) ? (r.bloom as BloomLevel) : "";
  const unit = Number.isInteger(r.unit) && (r.unit as number) > 0 ? (r.unit as number) : undefined;
  const out: ReturnType<typeof cleanPaperQuestion> = {
    text: cleanText(r.text), ...cleanImage(r), cos, bloom, ...(unit ? { unit } : {}),
    // A faculty-decides part: the question's own kind and whole marks.
    ...(setPart.flexible ? { kind: part.kind, marks: Math.max(1, Math.min(100, Math.round(Number(r.marks)) || 1)) } : {}),
  };
  if (part.kind === "MCQ") {
    const n = part.options ?? 4;
    out.options = Array.from({ length: n }, (_, i) => cleanText(Array.isArray(r.options) ? r.options[i] : "").slice(0, 500));
    const a = int(r.answer);
    out.answer = a >= 0 && a < n ? String(a) : "";
  } else if (part.kind === "FILL_BLANK") {
    out.answer = str(r.answer, 200);
  } else if (part.kind === "DESCRIPTIVE" && (part.maxSubParts ?? 1) > 1 && Array.isArray(r.subParts) && r.subParts.length > 1) {
    out.subParts = r.subParts.slice(0, part.maxSubParts).map((sp: Partial<PaperSubPart>) => ({
      text: cleanText(sp?.text), marks: setPart.flexible ? Math.max(0, Math.round(Number(sp?.marks)) || 0) : Math.max(0, Math.round(Number(sp?.marks) * 2) / 2 || 0), ...cleanImage(sp ?? {}),
    }));
  }
  return out;
}

/** What a COMPLETE question still lacks (empty = complete). */
export function paperQuestionErrors(q: ReturnType<typeof cleanPaperQuestion>, setPart: PaperPartDef, sw: MidOutcomeSwitches = ALL_OUTCOMES_ON): string[] {
  const errors: string[] = [];
  const part = partFor(setPart, q);
  const empty = (t: string) => !t.trim() || /^\$+\s*\$+$/.test(t.trim());
  if (q.subParts?.length) {
    q.subParts.forEach((sp, i) => { if (empty(sp.text)) errors.push(`Part (${"abcde"[i]}): write the question`); if (!(sp.marks > 0)) errors.push(`Part (${"abcde"[i]}): give it marks`); });
    const sum = q.subParts.reduce((n, sp) => n + sp.marks, 0);
    if (sum !== part.marksEach) errors.push(`Parts must add up to ${part.marksEach} marks (now ${sum})`);
  } else if (empty(q.text)) errors.push("Write the question");
  if (part.kind === "FILL_BLANK" && !/_{3,}|\.{4,}/.test(q.text)) errors.push("Mark the blank with ____ (four underscores)");
  if (isObjective(part.kind) && !q.answer) errors.push(part.kind === "MCQ" ? "Mark the correct option" : "Give the answer");
  if (part.kind === "MCQ" && (q.options ?? []).some((o) => !o.trim())) errors.push("Fill every option");
  if (part.kind === "MCQ" && new Set((q.options ?? []).map((o) => o.trim().toLowerCase())).size !== (q.options ?? []).length) errors.push("Two options are the same");
  if (sw.cos && q.cos.length === 0) errors.push("Pick at least one Course Outcome");
  if (sw.bloom && !q.bloom) errors.push("Pick the Bloom's level");
  return errors;
}

/** Each set's progress and the paper set's totals from its questions. */
export function paperProgress(pat: Pick<MidPaperPattern, "parts" | "setsPerFaculty" | "sets">, questions: Pick<MidPaperQuestion, "set" | "state" | "partId" | "no" | "marks">[]): { setProgress: PaperSetProgress; completeCount: number; totalCount: number; allComplete: boolean } {
  const setProgress: PaperSetProgress = {};
  let allFit = true;
  // Only the papers this setter writes (the HOD may have shared them among several setters).
  for (const s of setNumbers(pat)) {
    const mine = questions.filter((q) => q.set === s);
    // Fixed parts have a set number of questions; a faculty-decides part as many as written (at least one).
    const flexTotal = pat.parts.filter((p) => p.flexible).reduce((n, p) => n + Math.max(1, flexibleQuestions(mine, s, p.id).length), 0);
    const problems = pat.parts.filter((p) => p.flexible).map((p) => flexibleProblem(p, flexibleQuestions(mine, s, p.id))).filter(Boolean);
    if (problems.length) allFit = false;
    setProgress[String(s)] = {
      complete: mine.filter((q) => q.state === "COMPLETE" && pat.parts.some((p) => p.id === q.partId)).length,
      total: questionCount(pat) + flexTotal, ...(problems.length ? { problems } : {}),
    };
  }
  const completeCount = Object.values(setProgress).reduce((n, x) => n + Math.min(x.complete, x.total), 0);
  const totalCount = Object.values(setProgress).reduce((n, x) => n + x.total, 0);
  return { setProgress, completeCount, totalCount, allComplete: allFit && totalCount > 0 && completeCount >= totalCount };
}

/** A blank question's text keys, for the duplicate check across the faculty's sets. */
export const questionTexts = (q: Pick<MidPaperQuestion, "text" | "subParts" | "options">) =>
  [q.text, ...(q.subParts ?? []).map((s) => s.text)].filter((t) => t.trim());

/** The parts of a pattern as they shape a paper (what "the pattern changed" compares - not who saved it or when). */
export const patternShape = (pat: Pick<MidPaperPattern, "parts" | "setsPerFaculty" | "durationMinutes">) => JSON.stringify({
  sets: pat.setsPerFaculty, minutes: pat.durationMinutes,
  parts: pat.parts.map((p) => ({ id: p.id, label: p.label, title: p.title, flexible: !!p.flexible, kind: p.kind, perUnit: p.perUnit ?? 0, maxMarks: p.maxMarks ?? 0,
    marksEach: p.marksEach, choice: p.choice, options: p.options ?? 0, maxSubParts: p.maxSubParts ?? 0, questions: p.perUnit || p.flexible ? 0 : p.questions })),
});

/**
 * Moving a paper's questions onto a newer pattern: a per-unit part's question goes to the same place among its
 * unit's questions (Unit 2's first question stays Unit 2's first); a fixed part keeps question numbers; a
 * faculty-decides part keeps all its questions. `dropped` = questions with no place in the new pattern (the move
 * is refused then, so nothing written is ever lost).
 */
export function remapQuestions(
  oldPat: Pick<MidPaperPattern, "parts" | "setsPerFaculty">, newPat: Pick<MidPaperPattern, "parts" | "setsPerFaculty">,
  questions: Pick<MidPaperQuestion, "id" | "set" | "partId" | "no" | "unit">[], units: number[],
): { moves: { from: string; to: string }[]; dropped: string[] } {
  const moves: { from: string; to: string }[] = [];
  const dropped: string[] = [];
  for (const q of questions) {
    const np = newPat.parts.find((p) => p.id === q.partId);
    const op = oldPat.parts.find((p) => p.id === q.partId);
    if (!np || q.set > newPat.setsPerFaculty || !!np.flexible !== !!op?.flexible) { dropped.push(q.id); continue; }
    if (np.flexible) { moves.push({ from: q.id, to: q.id }); continue; }
    if (np.perUnit) {
      const unit = q.unit ?? (op ? unitOfQuestion(op, units, q.no) : undefined);
      // Its place among the old part's questions of the same unit.
      const oldNos = questions.filter((x) => x.set === q.set && x.partId === q.partId && (x.unit ?? (op ? unitOfQuestion(op, units, x.no) : undefined)) === unit).map((x) => x.no).sort((a, b) => a - b);
      const k = oldNos.indexOf(q.no);
      const slots = (np.unitLayout ?? []).map((u, i) => (u === unit ? i + 1 : 0)).filter(Boolean);
      if (unit == null || k < 0 || k >= slots.length) { dropped.push(q.id); continue; }
      moves.push({ from: q.id, to: questionId(q.set, q.partId, slots[k]) });
      continue;
    }
    if (q.no > np.questions) { dropped.push(q.id); continue; }
    moves.push({ from: q.id, to: q.id });
  }
  return { moves, dropped };
}
