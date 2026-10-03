import { describe, expect, it } from "vitest";
import { buildRows, insertRow, mergeHidden, moveRow, toOrder } from "./builderModel";
import type { NavItem } from "@/components/layout/navConfig";
import type { CustomPageSummary } from "@/types";

const it_ = (href: string, section?: string): NavItem => ({ label: href.slice(1), href, iconName: "X", roles: ["HOD"], section });
const builtIn = [it_("/a"), it_("/b", "Staff"), it_("/c"), it_("/d", "Reports")];
const page = (id: string, roles: string[], extra: Partial<CustomPageSummary> = {}): CustomPageSummary =>
  ({ id, title: `Page ${id}`, iconName: "Bell", roles: roles as CustomPageSummary["roles"], enabled: true, ...extra });

describe("buildRows", () => {
  it("lists built-in tabs in default order with their modules", () => {
    const rows = buildRows("HOD", builtIn, [], undefined);
    expect(rows.map((r) => [r.href, r.module, r.kind])).toEqual([
      ["/a", "", "builtin"], ["/b", "Staff", "builtin"], ["/c", "Staff", "builtin"], ["/d", "Reports", "builtin"],
    ]);
  });
  it("adds only the role's own custom pages, appended when unordered, and flags them", () => {
    const rows = buildRows("HOD", builtIn, [page("1", ["HOD"]), page("2", ["PRINCIPAL"])], undefined);
    expect(rows.map((r) => r.href)).toEqual(["/a", "/b", "/c", "/d", "/pages/1"]);
    expect(rows[4]).toMatchObject({ kind: "custom", pageId: "1", enabled: true, label: "Page 1" });
  });
  it("honours the saved order, including custom tabs, and shows disabled pages too", () => {
    const rows = buildRows("HOD", builtIn, [page("1", ["HOD"], { enabled: false, section: "Notices" })], ["/pages/1", "/a"]);
    expect(rows.map((r) => r.href)).toEqual(["/pages/1", "/a", "/b", "/c", "/d"]);
    expect(rows[0]).toMatchObject({ enabled: false, module: "Notices" });
  });
});

describe("moveRow / insertRow / toOrder", () => {
  it("moves a row to a target index and clamps out-of-range targets", () => {
    expect(moveRow([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveRow([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
    expect(moveRow([1, 2, 3], 1, 99)).toEqual([1, 3, 2]);
    expect(moveRow([1, 2, 3], 1, -5)).toEqual([2, 1, 3]);
    expect(moveRow([1, 2, 3], 9, 0)).toEqual([1, 2, 3]);
  });
  it("inserts at an index, clamped", () => {
    expect(insertRow([1, 2, 3], 1, 9)).toEqual([1, 9, 2, 3]);
    expect(insertRow([1, 2], 50, 9)).toEqual([1, 2, 9]);
    expect(insertRow([1, 2], -3, 9)).toEqual([9, 1, 2]);
  });
  it("derives the saved order from rows", () => {
    expect(toOrder([{ href: "/x" }, { href: "/y" }])).toEqual(["/x", "/y"]);
  });
});

describe("mergeHidden", () => {
  it("keeps entries the builder doesn't manage and replaces the managed ones", () => {
    expect(mergeHidden(["/old-injected", "/a"], ["/a", "/b", "/pages/1"], new Set(["/b", "/pages/1"]))).toEqual(["/old-injected", "/b", "/pages/1"]);
  });
  it("un-hides when nothing is toggled hidden", () => {
    expect(mergeHidden(["/a"], ["/a"], new Set())).toEqual([]);
  });
});
