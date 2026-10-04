// The types of student permission. Same taxonomy the (previously placeholder)
// student Permissions page showed, now the single source: the Principal /
// delegated HOD route and enable/disable by group or by individual item, so a
// category's `id` and its `groupId` are both valid routing keys.

export interface PermissionCategory { id: string; groupId: string; label: string }
export interface PermissionGroup { id: string; label: string; items: PermissionCategory[] }

const slug = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function group(id: string, label: string, items: string[]): PermissionGroup {
  return { id, label, items: items.map((l) => ({ id: `${id}.${slug(l)}`, groupId: id, label: l })) };
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  group("dept-events", "Department Events & Activities", ["Student events", "Training programs", "Workshops", "Webinars", "Guest lectures"]),
  group("certifications", "Certifications", ["NPTEL", "Global certifications", "Online certifications", "Professional certifications"]),
  group("external-participation", "External Participation", ["Hackathons", "Technical events", "Sports", "Cultural events", "Paper presentations", "Project competitions", "Conferences/symposiums"]),
  group("counselling", "Counselling", ["Faculty allotment", "Counselling schedule", "Attendance", "Individual remarks", "Weekly consolidated remarks"]),
  group("internship-training", "Internship & Training", ["Internships", "Industry training", "Summer internships", "External training programs"]),
  group("research-projects", "Research & Projects", ["Research activities", "Project participation", "Paper publication/presentation", "Patent activities", "External project work"]),
  group("clubs-activities", "Clubs & Student Activities", ["Club activities", "Student-organized events", "Inter-college activities", "Student societies"]),
  group("placement-career", "Placement & Career", ["Placement drives", "Off-campus drives", "Interviews", "Career fairs", "Placement training"]),
];

export const ALL_CATEGORIES: PermissionCategory[] = PERMISSION_GROUPS.flatMap((g) => g.items);

const byId = new Map(ALL_CATEGORIES.map((c) => [c.id, c]));
export const findCategory = (id: string): PermissionCategory | undefined => byId.get(id);

/** Routing keys for a category, most specific first: the item, then its group. */
export const categoryTypeKeys = (c: Pick<PermissionCategory, "id" | "groupId">): string[] => [c.id, c.groupId];
