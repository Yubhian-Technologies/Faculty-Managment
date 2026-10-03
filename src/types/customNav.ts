import type { UserRole } from "./core";

// ─── Custom dashboard tabs & pages (Super Admin, per college) ────────────────
// A Super Admin can add their own tabs to a college's sidebar, attach a page
// built from a few basic blocks, number/reorder every tab and switch each one
// on or off per role. Built-in tabs are never edited - only their order and
// visibility (the latter through the existing NavVisibilitySettings).

export type CustomPageBlock =
  | { id: string; type: "heading"; text: string; level: 1 | 2 | 3 }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "button"; label: string; href: string; variant: "primary" | "outline"; newTab?: boolean }
  | { id: string; type: "image"; url: string; alt: string; caption?: string }
  | { id: string; type: "divider" }
  | { id: string; type: "linkList"; title?: string; links: { label: string; href: string; newTab?: boolean }[] }
  | { id: string; type: "infoCard"; title: string; body: string; tone: "info" | "success" | "warning" };

export type CustomPageBlockType = CustomPageBlock["type"];

export interface CustomPage {
  id: string;
  collegeId: string;
  title: string;
  iconName: string;
  /** Optional sidebar section header this tab sits under. */
  section?: string;
  /** Roles whose sidebar gets this tab. */
  roles: UserRole[];
  /** Master switch: off = the tab and its page are unavailable to everyone. */
  enabled: boolean;
  blocks: CustomPageBlock[];
  createdAt?: string; // ISO
  updatedAt?: string; // ISO
  updatedByName?: string;
}

/** What the sidebar needs about a page - no blocks. */
export type CustomPageSummary = Pick<CustomPage, "id" | "title" | "iconName" | "section" | "roles" | "enabled" | "updatedAt">;

/**
 * Saved tab order, per role: sidebar hrefs, first to last. Built-in tabs use
 * their normal href; a custom tab uses its page href (customPageHref). A tab
 * missing from the list keeps its default position after the listed ones.
 */
export interface CustomNavLayout {
  order: Partial<Record<UserRole, string[]>>;
  updatedAt?: string;
  updatedByName?: string;
}

export const CUSTOM_PAGE_HREF_PREFIX = "/pages/";
export const customPageHref = (id: string) => `${CUSTOM_PAGE_HREF_PREFIX}${id}`;
export const isCustomPageHref = (href: string) => href.startsWith(CUSTOM_PAGE_HREF_PREFIX);
