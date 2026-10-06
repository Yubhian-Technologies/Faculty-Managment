import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ readOnly: false, path: "/panel/profile" }));
vi.mock("next/navigation", () => ({ usePathname: () => h.path }));
vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel: (s: { user: { readOnlyAccess?: boolean } | null }) => unknown) => sel({ user: { readOnlyAccess: h.readOnly || undefined } }),
}));

vi.mock("@/components/layout/ReadOnlyHome", () => ({
  ReadOnlyHome: ({ blockedPath }: { blockedPath?: string }) => createElement("section", null, `READ-ONLY-HOME for ${blockedPath}`),
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

  it("read-only + any other page (their dashboard, edit URLs, write pages): the page is NOT rendered, the read-only home is", () => {
    h.readOnly = true;
    for (const p of ["/panel", "/panel/students", "/panel/mark-attendance", "/panel/profile/edit", "/panel/profile/personal/edit", "/panel/leave/apply", "/hod/sections"]) {
      h.path = p;
      const out = render();
      expect(out, p).not.toContain("PAGE-CONTENT");
      expect(out, p).toContain(`READ-ONLY-HOME for ${p}`);
    }
  });
});
