import type { BloomLevel, MidBankFormat, MidQuestionPart } from "@/types/midQuestionBank";
import { BLOOM_LEVELS, LIMITS, MID_IMAGE_URL_PREFIX } from "./constants";

// One question's parts: shaping whatever the editor sent (drafts keep anything
// the right shape) and the academic checks a COMPLETE question must pass.
// Messages are keyed by field so the editor can show each beside its input.

export const partsFor = (format: MidBankFormat) => (format === "PARTS_AB" ? 2 : 1);
export const partLabel = (format: MidBankFormat, i: number) => (format === "PARTS_AB" ? `Part (${i === 0 ? "a" : "b"})` : "Question");

/** Shape the parts sent by the editor: right count, trimmed, capped, only known CO ids. */
export function cleanParts(raw: unknown, format: MidBankFormat, coIds: Set<string>): MidQuestionPart[] {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: partsFor(format) }, (_, i) => {
    const p = (list[i] ?? {}) as Partial<MidQuestionPart>;
    const imageUrl = typeof p.imageUrl === "string" && p.imageUrl.startsWith(MID_IMAGE_URL_PREFIX) ? p.imageUrl : "";
    const cos = Array.isArray(p.cos) ? [...new Set(p.cos.map(String).filter((c) => coIds.has(c)))].sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))) : [];
    const bloom = BLOOM_LEVELS.includes(p.bloom as BloomLevel) ? (p.bloom as BloomLevel) : "";
    return {
      text: String(p.text ?? "").slice(0, LIMITS.questionText),
      ...(imageUrl ? { imageUrl, imageCaption: String(p.imageCaption ?? "").replace(/\s+/g, " ").trim().slice(0, LIMITS.imageCaption) } : {}),
      cos,
      bloom,
    };
  });
}

/** Checks a COMPLETE question must pass. Empty object = valid. */
export function questionErrors(parts: MidQuestionPart[], format: MidBankFormat): Record<string, string> {
  const errors: Record<string, string> = {};
  if (parts.length !== partsFor(format)) errors.parts = `This bank's questions have ${partsFor(format)} part(s)`;
  parts.forEach((p, i) => {
    const label = partLabel(format, i);
    if (!p.text.trim() || /^\$+\s*\$+$/.test(p.text.trim())) errors[`parts.${i}.text`] = `${label}: write the question (text or a formula)`;
    if (p.cos.length === 0) errors[`parts.${i}.cos`] = `${label}: pick at least one Course Outcome`;
    if (!p.bloom) errors[`parts.${i}.bloom`] = `${label}: pick one Bloom's level (L2, L3 or L4)`;
    if (p.imageCaption && !p.imageUrl) errors[`parts.${i}.imageCaption`] = `${label}: a caption needs an image`;
  });
  return errors;
}

export const isBlankPart = (p: MidQuestionPart) => !p.text.trim() && !p.imageUrl && p.cos.length === 0 && !p.bloom;
