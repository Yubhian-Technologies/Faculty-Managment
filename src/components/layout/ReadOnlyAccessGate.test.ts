import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ readOnly: false, path: "/panel/profile" }));
vi.mock("next/navigation", () => ({ usePathname: () => h.path }));
vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel: (s: { user: { readOnlyAccess?: boolean } | null }) => unknown) => sel({ user: { readOnlyAccess: h.readOnly || undefined } }),
}));

import { ReadOnlyAccessGate } from "./ReadOnlyAccessGate";

const render = () => renderToStaticMarkup(createElement(ReadOnlyAccessGate, null, createElement("div", null, "PAGE-CONTENT")));

describe("ReadOnlyAccessGate", () => {
  beforeEach(() => { h.readOnly = false; h.path = "/panel/profile"; });

  it("is invisible to everyone who is not read-only (children only, no banner)", () => {
    for (const p of ["/panel/students", "/hod/students", "/panel/profile/edit"]) {
      h.path = p;
      const out = render();
      expect(out).toBe("<div>PAGE-CONTENT</div>");
    }
  });

  it("read-only + an allowed page: banner above the page", () => {
    h.readOnly = true;
    for (const p of ["/panel/profile", "/panel/attendance", "/panel/leave", "/panel/leave/history/casual"]) {
      h.path = p;
      const out = render();
      expect(out, p).toContain("Read-only access");
      expect(out, p).toContain("PAGE-CONTENT");
    }
  });

  it("read-only + any other page: the page is NOT rendered, a short explanation with links is", () => {
    h.readOnly = true;
    for (const p of ["/panel", "/panel/students", "/panel/mark-attendance", "/panel/profile/edit", "/panel/leave/apply", "/hod/sections"]) {
      h.path = p;
      const out = render();
      expect(out, p).not.toContain("PAGE-CONTENT");
      expect(out, p).toContain("Read-only access");
      expect(out, p).toContain("/panel/attendance");
    }
  });
});
