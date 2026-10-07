// Per-subject cell colors for the timetable editor. Class strings are literal so Tailwind keeps them.
export const SUBJECT_COLORS = {
  red: { cell: "bg-red-100 border-red-300", dot: "bg-red-400" },
  orange: { cell: "bg-orange-100 border-orange-300", dot: "bg-orange-400" },
  yellow: { cell: "bg-yellow-100 border-yellow-300", dot: "bg-yellow-400" },
  green: { cell: "bg-green-100 border-green-300", dot: "bg-green-400" },
  teal: { cell: "bg-teal-100 border-teal-300", dot: "bg-teal-400" },
  blue: { cell: "bg-blue-100 border-blue-300", dot: "bg-blue-400" },
  purple: { cell: "bg-purple-100 border-purple-300", dot: "bg-purple-400" },
  pink: { cell: "bg-pink-100 border-pink-300", dot: "bg-pink-400" },
} as const;

export type SubjectColor = keyof typeof SUBJECT_COLORS;

export const isSubjectColor = (v: unknown): v is SubjectColor =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(SUBJECT_COLORS, v);
