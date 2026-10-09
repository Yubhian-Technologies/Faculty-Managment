import { describe, expect, it } from "vitest";
import {
  buildListUrl,
  readListChoice,
  readListInt,
  readListString,
  resolveListBack,
  safeListBack,
  withListBack,
} from "./listReturn";

const sp = (url: string) => new URL(url, "http://x").searchParams;

describe("buildListUrl", () => {
  it("is the bare path when nothing differs from the defaults", () => {
    expect(buildListUrl("/a", { page: 1, q: "", load: false, dept: "all" }, { page: 1, dept: "all" })).toBe("/a");
  });

  it("round-trips awkward values", () => {
    const url = buildListUrl("/a", { load: true, dept: "C S & E/x", page: 3, q: "a=b c" }, { dept: "all", page: 1 });
    const p = sp(url);
    expect(p.get("load")).toBe("1");
    expect(p.get("dept")).toBe("C S & E/x");
    expect(readListInt(p, "page", 1)).toBe(3);
    expect(p.get("q")).toBe("a=b c");
  });
});

describe("readers", () => {
  it("fall back on missing or malformed values", () => {
    const p = sp("/a?n=abc&m=-2&s=7&tab=nope");
    expect(readListInt(p, "n", 4)).toBe(4);
    expect(readListInt(p, "m", 4)).toBe(4);
    expect(readListInt(p, "s", 20, { allowed: [10, 20] })).toBe(20);
    expect(readListInt(p, "missing", 1)).toBe(1);
    expect(readListString(p, "missing", "all")).toBe("all");
    expect(readListChoice(p, "tab", ["roster", "graduates"] as const, "roster")).toBe("roster");
    expect(readListChoice(sp("/a?tab=graduates"), "tab", ["roster", "graduates"] as const, "roster")).toBe("graduates");
    expect(readListInt(null, "n", 9)).toBe(9);
  });
});

describe("back link", () => {
  const list = "/a/students?load=1&page=2";

  it("round-trips through a detail path, with or without existing params", () => {
    expect(resolveListBack(sp(withListBack("/a/students/1", list, "/a/students")), "/a/students")).toBe(list);
    const href = withListBack("/a/students/1/docs?x=1", list, "/a/students");
    expect(sp(href).get("x")).toBe("1");
    expect(resolveListBack(sp(href), "/a/students")).toBe(list);
  });

  it("falls back to the plain list", () => {
    expect(resolveListBack(sp("/a/students/1"), "/a/students")).toBe("/a/students");
    expect(withListBack("/a/students/1", null, "/a/students")).toBe("/a/students/1");
  });

  it("only honours its own list", () => {
    expect(safeListBack("/a/students", "/a/students")).toBe("/a/students");
    expect(safeListBack("/a/students/1", "/a/students")).toBeNull();
    expect(safeListBack("/a/studentsX", "/a/students")).toBeNull();
    expect(safeListBack("/b/students", "/a/students")).toBeNull();
    expect(safeListBack("//evil.example", "/a/students")).toBeNull();
    expect(safeListBack("/a/students?x=\\evil", "/a/students")).toBeNull();
    expect(safeListBack("https://evil.example/a/students", "/a/students")).toBeNull();
    expect(safeListBack("", "/a/students")).toBeNull();
  });
});
