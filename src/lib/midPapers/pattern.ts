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

/** How many of a part's questions a student answers. */
export function answeredCount(p: Pick<PaperPartDef, "questions" | "choice">): number {
  if (p.choice.kind === "ANY") return Math.min(p.questions, p.choice.answer);
  if (p.choice.kind === "OR_PAIRS") return Math.floor(p.questions / 2);
  return p.questions;
}
export const partMax = (p: Pick<PaperPartDef, "questions" | "choice" | "marksEach">) => answeredCount(p) * p.marksEach;
export const patternMax = (pat: Pick<MidPaperPattern, "parts">) => pat.parts.reduce((n, p) => n + partMax(p), 0);
export function choiceText(p: Pick<PaperPartDef, "questions" | "choice">): string {
  if (p.choice.kind === "ANY") return `Answer any ${p.choice.answer} of the ${p.questions} questions`;
  if (p.choice.kind === "OR_PAIRS") return "Answer one question from each pair";
  return "Answer all questions";
}
export const questionCount = (pat: Pick<MidPaperPattern, "parts">) => pat.parts.reduce((n, p) => n + p.questions, 0);

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
    const kind: PaperPartKind = PART_KINDS.some((k) => k.value === p.kind) ? (p.kind as PaperPartKind) : "DESCRIPTIVE";
    const questions = int(p.questions);
    const marksEach = Number(p.marksEach);
    if (!(questions >= 1 && questions <= 40)) errors.push(`${label}: 1 to 40 questions`);
    if (!(marksEach > 0 && marksEach <= 100) || Math.round(marksEach * 2) !== marksEach * 2) errors.push(`${label}: marks per question must be 0.5 to 100 (in halves)`);
    const c = (p.choice ?? { kind: "ALL" }) as PaperChoice;
    let choice: PaperChoice = { kind: "ALL" };
    if (c.kind === "ANY") {
      const answer = int((c as { answer?: unknown }).answer);
      if (!(answer >= 1 && answer < questions)) errors.push(`${label}: "answer any" must be fewer than the number of questions`);
      choice = { kind: "ANY", answer: answer || 1 };
    } else if (c.kind === "OR_PAIRS") {
      if (questions % 2 !== 0) errors.push(`${label}: OR pairs need an even number of questions`);
      choice = { kind: "OR_PAIRS" };
    }
    const options = kind === "MCQ" ? Math.max(2, Math.min(6, int(p.options) || 4)) : undefined;
    const maxSubParts = kind === "DESCRIPTIVE" ? Math.max(1, Math.min(5, int(p.maxSubParts) || 1)) : undefined;
    return {
      id, label, title: str(p.title, 120) || kindLabel(kind), kind, questions: questions || 1, marksEach: marksEach || 1, choice,
      ...(options ? { options } : {}), ...(maxSubParts ? { maxSubParts } : {}),
    };
  });
  return {
    value: { setsPerFaculty: setsPerFaculty || 1, durationMinutes: durationMinutes || 90, instruction: str(r.instruction, 300), regdBoxes, parts },
    errors,
  };
}

export const questionId = (set: number, partId: string, no: number) => `${set}_${partId}_${no}`;

/** Every question slot of every set, in paper order. */
export function questionSlots(pat: Pick<MidPaperPattern, "parts" | "setsPerFaculty">): { set: number; partId: string; no: number; id: string }[] {
  const out: { set: number; partId: string; no: number; id: string }[] = [];
  for (let set = 1; set <= pat.setsPerFaculty; set++) for (const p of pat.parts) for (let no = 1; no <= p.questions; no++) out.push({ set, partId: p.id, no, id: questionId(set, p.id, no) });
  return out;
}

const cleanText = (v: unknown) => String(v ?? "").slice(0, LIMITS.questionText);
const cleanImage = (v: { imageUrl?: unknown; imageCaption?: unknown }) => {
  const imageUrl = typeof v.imageUrl === "string" && v.imageUrl.startsWith(MID_IMAGE_URL_PREFIX) ? v.imageUrl : "";
  return imageUrl ? { imageUrl, imageCaption: str(v.imageCaption, LIMITS.imageCaption) } : {};
};

/** Shape a question as the editor sent it, for its part (drafts keep whatever is the right shape). */
export function cleanPaperQuestion(raw: unknown, part: PaperPartDef, coIds: Set<string>): Pick<MidPaperQuestion, "text" | "imageUrl" | "imageCaption" | "options" | "answer" | "subParts" | "cos" | "bloom" | "unit"> {
  const r = (raw ?? {}) as Partial<MidPaperQuestion>;
  const cos = Array.isArray(r.cos) ? [...new Set(r.cos.map(String).filter((c) => coIds.has(c)))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))) : [];
  const bloom = BLOOM_LEVELS.includes(r.bloom as BloomLevel) ? (r.bloom as BloomLevel) : "";
  const unit = Number.isInteger(r.unit) && (r.unit as number) > 0 ? (r.unit as number) : undefined;
  const out: ReturnType<typeof cleanPaperQuestion> = { text: cleanText(r.text), ...cleanImage(r), cos, bloom, ...(unit ? { unit } : {}) };
  if (part.kind === "MCQ") {
    const n = part.options ?? 4;
    out.options = Array.from({ length: n }, (_, i) => cleanText(Array.isArray(r.options) ? r.options[i] : "").slice(0, 500));
    const a = int(r.answer);
    out.answer = a >= 0 && a < n ? String(a) : "";
  } else if (part.kind === "FILL_BLANK") {
    out.answer = str(r.answer, 200);
  } else if (part.kind === "DESCRIPTIVE" && (part.maxSubParts ?? 1) > 1 && Array.isArray(r.subParts) && r.subParts.length > 1) {
    out.subParts = r.subParts.slice(0, part.maxSubParts).map((sp: Partial<PaperSubPart>) => ({
      text: cleanText(sp?.text), marks: Math.max(0, Math.round(Number(sp?.marks) * 2) / 2 || 0), ...cleanImage(sp ?? {}),
    }));
  }
  return out;
}

/** What a COMPLETE question still lacks (empty = complete). */
export function paperQuestionErrors(q: ReturnType<typeof cleanPaperQuestion>, part: PaperPartDef, sw: MidOutcomeSwitches = ALL_OUTCOMES_ON): string[] {
  const errors: string[] = [];
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
export function paperProgress(pat: Pick<MidPaperPattern, "parts" | "setsPerFaculty">, questions: Pick<MidPaperQuestion, "set" | "state">[]): { setProgress: PaperSetProgress; completeCount: number; totalCount: number; allComplete: boolean } {
  const perSet = questionCount(pat);
  const setProgress: PaperSetProgress = {};
  for (let s = 1; s <= pat.setsPerFaculty; s++) setProgress[String(s)] = { complete: questions.filter((q) => q.set === s && q.state === "COMPLETE").length, total: perSet };
  const completeCount = Object.values(setProgress).reduce((n, x) => n + Math.min(x.complete, x.total), 0);
  const totalCount = perSet * pat.setsPerFaculty;
  return { setProgress, completeCount, totalCount, allComplete: totalCount > 0 && completeCount >= totalCount };
}

/** A blank question's text keys, for the duplicate check across the faculty's sets. */
export const questionTexts = (q: Pick<MidPaperQuestion, "text" | "subParts" | "options">) =>
  [q.text, ...(q.subParts ?? []).map((s) => s.text)].filter((t) => t.trim());
