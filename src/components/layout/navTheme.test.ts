import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "./navConfig";
import { NAV_ICON_NAMES } from "./NavIcon";
import { navHue } from "./navTheme";

describe("sidebar menu look", () => {
  it("every menu item's icon exists (a missing one silently shows the Dashboard grid)", () => {
    const missing = [...new Set(NAV_ITEMS.map((i) => i.iconName))].filter((n) => !NAV_ICON_NAMES.includes(n));
    expect(missing).toEqual([]);
  });

  it("section colors come from the title", () => {
    expect(navHue(null)).toBe("blue");
    expect(navHue("Leave & Attendance")).toBe("amber");
    expect(navHue("My Leave & Attendance")).toBe("amber");
    expect(navHue("Budget & Purchases")).toBe("green");
    expect(navHue("Payroll")).toBe("green");
    expect(navHue("Student Fees")).toBe("green");
    expect(navHue("Staff & HR")).toBe("teal");
    expect(navHue("Hiring")).toBe("teal");
    expect(navHue("Academics")).toBe("violet");
    expect(navHue("Mid Exams")).toBe("violet");
    expect(navHue("Personal")).toBe("sky");
    expect(navHue("Approvals")).toBe("slate");
  });
});
