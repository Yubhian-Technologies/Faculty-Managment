import type { BloomLevel, MidBankFormat, MidQuestion, MidQuestionFormat, MidQuestionPart } from "@/types/midQuestionBank";
import { BLOOM_LEVELS, LIMITS, MID_IMAGE_URL_PREFIX } from "./constants";

// One question's parts: shaping whatever the editor sent (drafts keep anything
// the right shape) and the academic checks a COMPLETE question must pass.
// Messages are keyed by field so the editor can show each beside its input.
//
// Format: the Exam Cell ticks the question types a bank allows (one question,
// parts (a) + (b), (a) + (b) + (c) ...); the faculty picks one per question.
// Marks: a single question carries the bank's marks; parts split them as the
// faculty sets, and must add up to them.

/** Every question type, fewest parts first. A type with n parts needs at least n marks. */
export const QUESTION_FORMATS: MidQuestionFormat[] = ["SINGLE", "PARTS_AB", "PARTS_ABC", "PARTS_ABCD", "PARTS_ABCDE"];
export const partsFor = (format: MidQuestionFormat) => (format === "SINGLE" ? 1 : format.length - "PARTS_".length);
const letter = (i: number) => "abcde"[i] ?? String(i + 1);
export const partLetter = letter;
export const partLabel = (format: MidQuestionFormat, i: number) => (format === "SINGLE" ? "Question" : `Part (${letter(i)})`);
/** "One question" / "Parts (a) + (b) + (c)". */
export const formatName = (format: MidQuestionFormat) =>
  format === "SINGLE" ? "One question" : `Parts ${Array.from({ length: partsFor(format) }, (_, i) => `(${letter(i)})`).join(" + ")}`;
const listParts = (n: number) => {
  const l = Array.from({ length: n }, (_, i) => `(${letter(i)})`);
  return l.length > 1 ? `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}` : l[0];
};

/** The types a bank (or rule) allows: its ticked list, else what an older single `format` meant. */
export function allowedFormats(x: { formats?: unknown; format?: MidBankFormat | string }): MidQuestionFormat[] {
  const list = Array.isArray(x.formats) ? x.formats : [];
  const ticked = QUESTION_FORMATS.filter((f) => list.includes(f));
  if (ticked.length) return ticked;
  if (x.format === "EITHER") return ["SINGLE", "PARTS_AB"];
  if (x.format === "PARTS_AB") return ["PARTS_AB"];
  return ["SINGLE"];
}

/** The type a question uses: the one asked for when allowed, else the bank's first. */
export function questionFormat(allowed: MidQuestionFormat[], wanted?: unknown): MidQuestionFormat {
  return allowed.includes(wanted as MidQuestionFormat) ? (wanted as MidQuestionFormat) : allowed[0] ?? "SINGLE";
}
/** A saved question's type: its own, else (older docs) from its number of parts. */
export const formatOf = (q: Pick<MidQuestion, "format" | "parts">, allowed: MidQuestionFormat[]): MidQuestionFormat =>
  q.format ?? QUESTION_FORMATS[q.parts.length - 1] ?? allowed[0] ?? "SINGLE";

/** An even starting split of the question's marks over its parts (5 + 5, 4 + 3 + 3 ...). */
export function defaultSplit(format: MidQuestionFormat, total: number): number[] {
  const n = partsFor(format);
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i < total - base * n ? 1 : 0));
}

/** A part's marks as shown and printed: its own, else the even split (older questions). */
export const partMarks = (p: MidQuestionPart, i: number, format: MidQuestionFormat, total: number) =>
  format === "SINGLE" ? total : (typeof p.marks === "number" && p.marks > 0 ? p.marks : defaultSplit(format, total)[i]);

/** Shape the parts sent by the editor: right count, trimmed, capped, only known CO ids, whole-number marks. */
export function cleanParts(raw: unknown, format: MidQuestionFormat, coIds: Set<string>, total: number): MidQuestionPart[] {
  const list = Array.isArray(raw) ? raw : [];
  const split = defaultSplit(format, total);
  return Array.from({ length: partsFor(format) }, (_, i) => {
    const p = (list[i] ?? {}) as Partial<MidQuestionPart>;
    const imageUrl = typeof p.imageUrl === "string" && p.imageUrl.startsWith(MID_IMAGE_URL_PREFIX) ? p.imageUrl : "";
    const cos = Array.isArray(p.cos) ? [...new Set(p.cos.map(String).filter((c) => coIds.has(c)))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))) : [];
    const bloom = BLOOM_LEVELS.includes(p.bloom as BloomLevel) ? (p.bloom as BloomLevel) : "";
    const m = Number(p.marks);
    const marks = format === "SINGLE" ? total : Number.isInteger(m) && m >= 0 && m <= total ? m : split[i];
    return {
      text: String(p.text ?? "").slice(0, LIMITS.questionText),
      ...(imageUrl ? { imageUrl, imageCaption: String(p.imageCaption ?? "").replace(/\s+/g, " ").trim().slice(0, LIMITS.imageCaption) } : {}),
      cos,
      bloom,
      marks,
    };
  });
}

/** Checks a COMPLETE question must pass. Empty object = valid. */
export function questionErrors(parts: MidQuestionPart[], format: MidQuestionFormat, total: number): Record<string, string> {
  const errors: Record<string, string> = {};
  if (parts.length !== partsFor(format)) errors.parts = `This question has ${partsFor(format)} part(s)`;
  parts.forEach((p, i) => {
    const label = partLabel(format, i);
    if (!p.text.trim() || /^\$+\s*\$+$/.test(p.text.trim())) errors[`parts.${i}.text`] = `${label}: write the question (text or a formula)`;
    else if (/\\placeholder\b/.test(p.text)) errors[`parts.${i}.text`] = `${label}: a formula still has empty boxes - click it in the preview and fill or delete them`;
    if (p.cos.length === 0) errors[`parts.${i}.cos`] = `${label}: pick at least one Course Outcome`;
    if (!p.bloom) errors[`parts.${i}.bloom`] = `${label}: pick one Bloom's level (L2, L3 or L4)`;
    if (p.imageCaption && !p.imageUrl) errors[`parts.${i}.imageCaption`] = `${label}: a caption needs an image`;
    if (format !== "SINGLE" && !(Number(p.marks) >= 1)) errors[`parts.${i}.marks`] = `${label}: give it at least 1 mark`;
  });
  if (format !== "SINGLE") {
    const sum = parts.reduce((n, p) => n + (Number(p.marks) || 0), 0);
    if (sum !== total) errors.marks = `Parts ${listParts(parts.length)} must add up to ${total} marks (now ${sum})`;
  }
  return errors;
}

/** How a bank's questions are set, in words: "One question or Parts (a) + (b), 10 marks". */
export function bankFormatText(allowed: MidQuestionFormat[], marks: number): string {
  return `${allowed.map((f, i) => (i === 0 ? formatName(f) : formatName(f).replace(/^O|^P/, (c) => c.toLowerCase()))).join(" or ")}, ${marks} marks`;
}

export const isBlankPart = (p: MidQuestionPart) => !p.text.trim() && !p.imageUrl && p.cos.length === 0 && !p.bloom;
