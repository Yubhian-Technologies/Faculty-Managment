import type { BloomLevel, MidBankFormat, MidQuestion, MidQuestionFormat, MidQuestionPart } from "@/types/midQuestionBank";
import { BLOOM_LEVELS, LIMITS, MID_IMAGE_URL_PREFIX } from "./constants";

// One question's parts: shaping whatever the editor sent (drafts keep anything
// the right shape) and the academic checks a COMPLETE question must pass.
// Messages are keyed by field so the editor can show each beside its input.
//
// Format: the Exam Cell allows SINGLE, PARTS_AB, or EITHER (the faculty picks
// per question). Marks: a single question carries the bank's marks; parts (a)
// and (b) split them as the faculty sets, and must add up to them.

export const partsFor = (format: MidQuestionFormat) => (format === "PARTS_AB" ? 2 : 1);
export const partLabel = (format: MidQuestionFormat, i: number) => (format === "PARTS_AB" ? `Part (${i === 0 ? "a" : "b"})` : "Question");

/** The format a question uses: its own (when the bank allows either), else the bank's. */
export function questionFormat(bankFormat: MidBankFormat, wanted?: unknown): MidQuestionFormat {
  if (bankFormat !== "EITHER") return bankFormat;
  return wanted === "PARTS_AB" ? "PARTS_AB" : "SINGLE";
}
export const formatOf = (q: Pick<MidQuestion, "format" | "parts">, bankFormat: MidBankFormat): MidQuestionFormat =>
  q.format ?? (bankFormat === "EITHER" ? (q.parts.length > 1 ? "PARTS_AB" : "SINGLE") : bankFormat);

/** An even starting split of the question's marks over its parts (5 + 5, 5 + 4 ...). */
export function defaultSplit(format: MidQuestionFormat, total: number): number[] {
  if (format === "SINGLE") return [total];
  const a = Math.ceil(total / 2);
  return [a, total - a];
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
    if (p.cos.length === 0) errors[`parts.${i}.cos`] = `${label}: pick at least one Course Outcome`;
    if (!p.bloom) errors[`parts.${i}.bloom`] = `${label}: pick one Bloom's level (L2, L3 or L4)`;
    if (p.imageCaption && !p.imageUrl) errors[`parts.${i}.imageCaption`] = `${label}: a caption needs an image`;
    if (format === "PARTS_AB" && !(Number(p.marks) >= 1)) errors[`parts.${i}.marks`] = `${label}: give it at least 1 mark`;
  });
  if (format === "PARTS_AB") {
    const sum = parts.reduce((n, p) => n + (Number(p.marks) || 0), 0);
    if (sum !== total) errors.marks = `Parts (a) and (b) must add up to ${total} marks (now ${sum})`;
  }
  return errors;
}

/** How a bank's questions are set, in words: "One question or parts (a) + (b), 10 marks". */
export function bankFormatText(format: MidBankFormat, marks: number): string {
  if (format === "SINGLE") return `One question, ${marks} marks`;
  if (format === "PARTS_AB") return `Parts (a) + (b) adding up to ${marks} marks`;
  return `One question or parts (a) + (b), ${marks} marks`;
}

export const isBlankPart = (p: MidQuestionPart) => !p.text.trim() && !p.imageUrl && p.cos.length === 0 && !p.bloom;
