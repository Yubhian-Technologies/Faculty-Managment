import { describe, expect, it } from "vitest";
import { applyNavLayout, customPagesToNavItems } from "./applyLayout";
import type { NavItem } from "@/components/layout/navConfig";

const item = (href: string, section?: string): NavItem => ({ label: href, href, iconName: "X", roles: ["HOD"], section });
const base = [item("/a"), item("/b", "Staff"), item("/c"), item("/d", "Reports"), item("/e")];
const hrefs = (xs: NavItem[]) => xs.map((x) => x.href);

describe("applyNavLayout", () => {
  it("returns the input untouched with no order and no custom tabs", () => {
    expect(applyNavLayout(base, {})).toBe(base);
  });

  it("sorts by the saved order and keeps unlisted tabs after the listed ones", () => {
    const out = applyNavLayout(base, { order: ["/e", "/a"] });
    expect(hrefs(out)).toEqual(["/e", "/a", "/b", "/c", "/d"]);
  });

  it("recomputes section headers so a moved tab never drags a stale header along", () => {
    const out = applyNavLayout(base, { order: ["/d", "/b", "/a"] });
    // /d (Reports) first -> header; /b (Staff) next -> header; /a (General) -> none (General has no header)
    expect(out.map((x) => [x.href, x.section])).toEqual([
      ["/d", "Reports"], ["/b", "Staff"], ["/a", undefined], ["/c", "Staff"], ["/e", "Reports"],
    ]);
  });

  it("inserts a custom tab at its saved position, inheriting the section it lands in", () => {
    const custom = [item("/pages/p1")];
    const out = applyNavLayout(base, { order: ["/a", "/b", "/pages/p1", "/c"], customItems: custom });
    expect(hrefs(out).slice(0, 4)).toEqual(["/a", "/b", "/pages/p1", "/c"]);
    expect(out[2].section).toBeUndefined(); // same module (Staff) as /b
  });

  it("gives a custom tab with its own section a header, and appends one with no saved position", () => {
    const out = applyNavLayout(base, { customItems: [{ ...item("/pages/p2"), section: "Notices" }] });
    expect(out[out.length - 1]).toMatchObject({ href: "/pages/p2", section: "Notices" });
  });

  it("drops hidden custom tabs and ignores order entries for tabs the login doesn't have", () => {
    const out = applyNavLayout(base, { order: ["/zzz", "/pages/p1"], customItems: [item("/pages/p1")], hiddenHrefs: ["/pages/p1"] });
    expect(hrefs(out)).toEqual(hrefs(base));
  });

  it("does not duplicate a custom tab already in the list", () => {
    const withCustom = [...base, item("/pages/p1")];
    const out = applyNavLayout(withCustom, { customItems: [item("/pages/p1")], order: ["/pages/p1"] });
    expect(hrefs(out).filter((h) => h === "/pages/p1")).toHaveLength(1);
  });
});

describe("customPagesToNavItems", () => {
  const pages = [
    { id: "1", title: "Notices", iconName: "Bell", roles: ["HOD"] },
    { id: "2", title: "Finance", iconName: "Wallet", roles: ["PRINCIPAL"], section: "Money" },
  ];
  it("keeps only pages for a held role and maps them to nav items", () => {
    const out = customPagesToNavItems(pages, ["HOD", "PANEL_MEMBER"], (id) => `/pages/${id}`);
    expect(out).toEqual([{ label: "Notices", href: "/pages/1", iconName: "Bell", roles: ["HOD"], section: undefined }]);
  });
});
