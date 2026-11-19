// Colors of the navy sidebar (Sidebar.tsx, MobileDrawer.tsx). Each menu section gets a hue from its title, so every
// role - and any section a Super Admin builds - is colored the same way without a list to keep in step. The class
// strings are written out in full so Tailwind keeps them.

export type NavHue = "blue" | "violet" | "teal" | "amber" | "green" | "sky" | "slate";

const RULES: [NavHue, RegExp][] = [
  ["amber", /leave|attendance/i],
  ["green", /budget|purchase|payroll|pay|fee|account|financ|payment/i],
  ["teal", /staff|hr\b|^hr|hiring|recruit|faculty|users|people|management|administration|organi[sz]ation|department/i],
  ["violet", /academ|exam|mid|result|student|certificate|library|research|curriculum|syllabus/i],
  ["sky", /personal|^my\b|my work|requests|additional|communication/i],
];

/** A section's hue: the first rule its title matches; the untitled top group is blue, anything else slate. */
export function navHue(title: string | null): NavHue {
  if (!title) return "blue";
  return RULES.find(([, re]) => re.test(title))?.[0] ?? "slate";
}

/** Icon color of a menu item on the navy background. */
export const HUE_ICON: Record<NavHue, string> = {
  blue: "text-blue-300",
  violet: "text-violet-300",
  teal: "text-teal-300",
  amber: "text-amber-300",
  green: "text-emerald-300",
  sky: "text-sky-300",
  slate: "text-slate-300",
};

/** The small square beside a section title. */
export const HUE_DOT: Record<NavHue, string> = {
  blue: "bg-blue-300",
  violet: "bg-violet-300",
  teal: "bg-teal-300",
  amber: "bg-amber-300",
  green: "bg-emerald-300",
  sky: "bg-sky-300",
  slate: "bg-slate-300",
};

/** Background of the sidebar / drawer. */
export const NAV_SURFACE = "bg-gradient-to-b from-[#14224d] to-[#0f1a3c] text-[#c9d3ee] border-[#0f1a3c]";
/** The open page's row. */
export const NAV_ACTIVE = "bg-gradient-to-r from-[#3b63f0] to-[#5b7cf7] text-white font-semibold shadow-[0_4px_14px_rgba(59,99,240,0.45)]";
/** Any other row. */
export const NAV_IDLE = "text-[#c9d3ee] hover:bg-white/[0.07] hover:text-white";
/** Small muted text on the navy background. */
export const NAV_MUTED = "text-[#8fa0cc]";
