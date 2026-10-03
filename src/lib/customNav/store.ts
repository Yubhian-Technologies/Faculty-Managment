import type { CustomPage, CustomPageSummary, UserRole } from "@/types";

// Firestore layout (all under colleges/{collegeId}), written only through the
// Admin SDK by the routes below:
//   customPages/{pageId}        -> CustomPage
//   settings/navLayout          -> { order: { [role]: string[] }, updatedAt, updatedByName }
// Tab visibility is NOT stored here: it reuses settings/navVisibility.hiddenItems
// (keyed by role, holding the tab's href), so the existing feature-flag
// mechanism governs custom tabs exactly like built-in ones.

type FirestoreDate = { toDate?: () => Date } | Date | string | undefined | null;

export function toIso(v: FirestoreDate): string | undefined {
  if (!v) return undefined;
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  return v.toDate ? v.toDate().toISOString() : undefined;
}

export function serializePage(id: string, data: Record<string, unknown>): CustomPage {
  return {
    id,
    collegeId: String(data.collegeId ?? ""),
    title: String(data.title ?? ""),
    iconName: String(data.iconName ?? "LayoutDashboard"),
    section: (data.section as string | undefined) || undefined,
    roles: (data.roles as UserRole[] | undefined) ?? [],
    enabled: data.enabled !== false,
    blocks: (data.blocks as CustomPage["blocks"] | undefined) ?? [],
    createdAt: toIso(data.createdAt as FirestoreDate),
    updatedAt: toIso(data.updatedAt as FirestoreDate),
    updatedByName: data.updatedByName as string | undefined,
  };
}

export function toSummary(page: CustomPage): CustomPageSummary {
  const { id, title, iconName, section, roles, enabled, updatedAt } = page;
  return { id, title, iconName, section, roles, enabled, updatedAt };
}

export function pageRef(db: FirebaseFirestore.Firestore, collegeId: string, pageId: string) {
  return db.collection("colleges").doc(collegeId).collection("customPages").doc(pageId);
}
export function layoutRef(db: FirebaseFirestore.Firestore, collegeId: string) {
  return db.collection("colleges").doc(collegeId).collection("settings").doc("navLayout");
}
export function visibilityRef(db: FirebaseFirestore.Firestore, collegeId: string) {
  return db.collection("colleges").doc(collegeId).collection("settings").doc("navVisibility");
}
