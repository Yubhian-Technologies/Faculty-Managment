import { describe, expect, it } from "vitest";
import { filterVisibleNavItems, getCollegeAdminNavItems, getNavItemsForRole } from "./navConfig";
import { groupNavItems } from "./navGroups";

describe("groupNavItems", () => {
  it("groups a Principal's menu under module headers", () => {
    const groups = groupNavItems(filterVisibleNavItems(getNavItemsForRole("PRINCIPAL"), [], [], "PRINCIPAL", true));
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.some((g) => g.title)).toBe(true);
  });

  it("groups a College Admin's menu into named modules, none of them empty or personal", () => {
    const groups = groupNavItems(filterVisibleNavItems(getCollegeAdminNavItems(), [], [], "COLLEGE_ADMIN", true));
    const titles = groups.map((g) => g.title).filter(Boolean);
    expect(titles.length).toBeGreaterThan(3);
    expect(titles).toContain("Research & Development");
    expect(titles).not.toContain("My Work");
    expect(titles).not.toContain("Personal");
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });
});
