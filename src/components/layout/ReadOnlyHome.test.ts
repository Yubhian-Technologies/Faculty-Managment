import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ status: "RESIGNED" as string | undefined }));
vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel: (s: { user: { uid: string; name: string } }) => unknown) => sel({ user: { uid: "u1", name: "Sivakumar Krishnan" } }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: h.status }) }));
vi.mock("@/components/shared/Avatar", () => ({ Avatar: () => createElement("i", null, "AVATAR") }));
vi.mock("@/components/faculty/FacultyProfileHub", () => ({
  FacultyStatusBadge: ({ status }: { status?: string }) => createElement("b", null, `STATUS:${status}`),
}));

import { ReadOnlyHome } from "@/components/layout/ReadOnlyHome";
import { readOnlyNavItems } from "@/components/layout/readOnlyNav";

beforeEach(() => { h.status = "RESIGNED"; });

describe("ReadOnlyHome", () => {
  it("greets the person, shows their status and links to exactly the three pages they can open", () => {
    const html = renderToStaticMarkup(createElement(ReadOnlyHome, { blockedPath: "/panel" }));
    expect(html).toContain("Welcome, Sivakumar");
    expect(html).toContain("STATUS:RESIGNED");
    expect(html).toContain("Read-only access");
    for (const href of ["/panel/profile", "/panel/attendance", "/panel/leave"]) expect(html).toContain(`href="${href}"`);
    expect((html.match(/<a /g) ?? []).length).toBe(3);                    // nothing else is offered
  });

  it("their own dashboard gets no 'not available' notice; any other blocked page does", () => {
    expect(renderToStaticMarkup(createElement(ReadOnlyHome, { blockedPath: "/panel" }))).not.toContain("isn&#x27;t available");
    expect(renderToStaticMarkup(createElement(ReadOnlyHome, {}))).not.toContain("isn&#x27;t available");
    expect(renderToStaticMarkup(createElement(ReadOnlyHome, { blockedPath: "/panel/students" }))).toContain("isn&#x27;t available");
  });

  it("works before the status has loaded (no badge, still the three links)", () => {
    h.status = undefined;
    const html = renderToStaticMarkup(createElement(ReadOnlyHome, { blockedPath: "/panel" }));
    expect(html).not.toContain("STATUS:");
    expect((html.match(/<a /g) ?? []).length).toBe(3);
  });
});

describe("readOnlyNavItems (the whole menu of a read-only person)", () => {
  it("is exactly My Profile, Leave, My Attendance - in that order - and nothing that changes anything", () => {
    const items = readOnlyNavItems();
    expect(items.map((i) => i.href)).toEqual(["/panel/profile", "/panel/leave", "/panel/attendance"]);
    expect(items.map((i) => i.label)).toEqual(["My Profile", "Leave", "My Attendance"]);
    expect(items[0].section).toBe("My records");
    expect(items.slice(1).every((i) => i.section === undefined)).toBe(true);
  });
});
