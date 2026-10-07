// Colours an HOD/faculty can give a subject on the Teaching Load timetable
// (screen, PDF and print share this one palette).
export const HIGHLIGHT_COLORS = {
  purple: { label: "Purple", bg: "#f3e8ff", border: "#c084fc", text: "#6b21a8" },
  blue: { label: "Blue", bg: "#dbeafe", border: "#60a5fa", text: "#1e40af" },
  green: { label: "Green", bg: "#dcfce7", border: "#4ade80", text: "#166534" },
  yellow: { label: "Yellow", bg: "#fef9c3", border: "#facc15", text: "#854d0e" },
  rose: { label: "Rose", bg: "#ffe4e6", border: "#fb7185", text: "#9f1239" },
  teal: { label: "Teal", bg: "#ccfbf1", border: "#2dd4bf", text: "#115e59" },
} as const;

export type HighlightColorKey = keyof typeof HIGHLIGHT_COLORS;
/** subject code (upper-case) -> palette key */
export type SubjectHighlights = Record<string, HighlightColorKey>;

/** The colour for the first of `keys` (code / name / id) that has one assigned. */
export function highlightFor(highlights: SubjectHighlights, ...keys: string[]) {
  for (const k of keys) {
    const c = highlights[k.toUpperCase().trim()];
    if (c) return HIGHLIGHT_COLORS[c];
  }
  return null;
}
