// Panel-stage prompts (candidate arrived, scoring open, feedback unlocked) are meant for the
// HOD-side interview panel and are noise on a Principal/VP/College Admin bell. New ones are no
// longer written for leadership (see excludeLeadershipUids in lib/notify.ts); this hides the ones
// stored before that fix. Shared by the notifications API and the live feed so both agree.

const LEADERSHIP = ["PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_ADMIN"];
const PANEL_PROMPT_TITLES = ["Panel Interview Scoring Open", "Panel Feedback Unlocked"];

export function hidePanelPrompts<T extends { type?: string; title?: string }>(role: string | undefined, items: T[]): T[] {
  if (!role || !LEADERSHIP.includes(role)) return items;
  return items.filter((n) => n.type !== "CANDIDATE_ARRIVED" && !PANEL_PROMPT_TITLES.includes(n.title ?? ""));
}
