import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// R8 - cosmetic polish for a read-only person (RESIGNED/RETIRED faculty). The server already enforces
// everything; these keep the screen honest and must change NOTHING for anyone else.

const h = vi.hoisted(() => ({ readOnly: false, fetchCalls: [] as string[], applyHref: "unset" as string | undefined }));

vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel: (s: { user: { uid: string; collegeId: string; readOnlyAccess?: boolean }; selectedCollegeId: null }) => unknown) =>
    sel({ user: { uid: "u1", collegeId: "c1", readOnlyAccess: h.readOnly || undefined }, selectedCollegeId: null }),
}));
vi.mock("@/lib/api/collegeFetch", () => ({ collegeFetch: async (url: string) => { h.fetchCalls.push(url); return new Response("{}"); } }));
vi.mock("@/lib/notifications/liveFeed", () => ({ subscribeToNotifications: () => () => {} }));
vi.mock("@/components/leave/LeaveProfileView", () => ({
  LeaveProfileView: (p: { applyHref?: string }) => { h.applyHref = p.applyHref; return createElement("div", null, p.applyHref ? "HAS-APPLY" : "NO-APPLY"); },
}));
vi.mock("@/components/shared/PageHeader", () => ({ PageHeader: () => null }));

import { readOnlyHiddenHrefs } from "@/components/layout/readOnlyNav";
import { getNavItemsForRole } from "@/components/layout/navConfig";
import { isAllowedReadOnlyPage } from "@/lib/auth/readOnlyAccess";
import { useNotifications } from "@/hooks/useNotifications";
import PanelLeavePage from "@/app/(dashboard)/panel/leave/page";

beforeEach(() => { h.readOnly = false; h.fetchCalls = []; h.applyHref = "unset"; });

describe("read-only navigation", () => {
  const hidden = readOnlyHiddenHrefs();

  it("hides the faculty menu entries a read-only person cannot open", () => {
    for (const href of ["/panel/students", "/panel/mark-attendance", "/panel/teaching", "/panel/internal-exam", "/panel"]) expect(hidden, href).toContain(href);
  });

  it("never hides a page they CAN open (profile, attendance history, leave history)", () => {
    for (const href of hidden) expect(isAllowedReadOnlyPage(href), href).toBe(false);
    const faculty = getNavItemsForRole("PANEL_MEMBER").map((i) => i.href);
    const kept = faculty.filter((href) => !hidden.includes(href));
    for (const href of kept) expect(isAllowedReadOnlyPage(href), `kept ${href} must be allowed`).toBe(true);
  });

  it("is built from the faculty nav only (so it cannot hide another role's entries)", () => {
    const faculty = new Set(getNavItemsForRole("PANEL_MEMBER").map((i) => i.href));
    for (const href of hidden) expect(faculty.has(href), href).toBe(true);
  });
});

describe("notifications: mark as read", () => {
  const run = async (fn: (api: ReturnType<typeof useNotifications>) => Promise<void>) => {
    let api!: ReturnType<typeof useNotifications>;
    const C = () => { api = useNotifications(); return null; };
    renderToStaticMarkup(createElement(C));
    await fn(api);
  };

  it("a read-only person sends NO request (the server would refuse a write anyway)", async () => {
    h.readOnly = true;
    await run(async (a) => { await a.markRead("n1"); await a.markAllRead(); });
    expect(h.fetchCalls).toEqual([]);
  });

  it("everyone else is unchanged: both actions still PATCH the notifications endpoint", async () => {
    await run(async (a) => { await a.markRead("n1"); await a.markAllRead(); });
    expect(h.fetchCalls).toEqual(["/api/college/notifications", "/api/college/notifications"]);
  });
});

describe("leave page Apply button", () => {
  it("is dropped for a read-only person, kept for everyone else", () => {
    h.readOnly = true;
    expect(renderToStaticMarkup(createElement(PanelLeavePage))).toContain("NO-APPLY");
    expect(h.applyHref).toBeUndefined();
    h.readOnly = false;
    expect(renderToStaticMarkup(createElement(PanelLeavePage))).toContain("HAS-APPLY");
    expect(h.applyHref).toBe("/panel/leave/apply");
  });
});
