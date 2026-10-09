import { describe, expect, it } from "vitest";
import {
  EMPTY_HOD_STUDENTS_LIST_STATE,
  buildHodStudentsListUrl,
  parseHodStudentsListState,
  safeHodStudentsBack,
  withHodStudentsBack,
} from "./hodListReturn";

const parse = (url: string) => parseHodStudentsListState(new URL(url, "http://x").searchParams);

describe("hod students list state <-> url", () => {
  it("is the bare path until the list has been loaded", () => {
    expect(buildHodStudentsListUrl(EMPTY_HOD_STUDENTS_LIST_STATE)).toBe("/hod/students");
    expect(parse("/hod/students")).toEqual(EMPTY_HOD_STUDENTS_LIST_STATE);
    // filters without load=1 are ignored - the list only auto-loads when it had been loaded
    expect(parse("/hod/students?department=CSE")).toEqual(EMPTY_HOD_STUDENTS_LIST_STATE);
  });

  it("round-trips every filter, the search, the page and the page size", () => {
    const state = {
      load: true,
      freshmanView: "none",
      deptFilter: "Computer Science & Engineering",
      coreDeptFilter: "AIDS",
      courseFilter: "B.Tech (Hons)",
      yearFilter: "2",
      search: "23471a04/ x&y=z",
      page: 3,
      pageSize: 50,
    };
    expect(parse(buildHodStudentsListUrl(state))).toEqual(state);
  });

  it("round-trips the Freshman's Department view", () => {
    const state = { ...EMPTY_HOD_STUDENTS_LIST_STATE, load: true, freshmanView: "Basic Science - Maths" };
    expect(parse(buildHodStudentsListUrl(state))).toEqual(state);
  });

  it("falls back on malformed values instead of failing", () => {
    const s = parse("/hod/students?load=1&year=abc&page=-4&pageSize=7");
    expect(s).toEqual({ ...EMPTY_HOD_STUDENTS_LIST_STATE, load: true });
  });
});

describe("back link", () => {
  const list = "/hod/students?load=1&department=CSE&page=2";

  it("is appended to a profile path and survives encoding", () => {
    const href = withHodStudentsBack("/hod/students/abc", list);
    expect(safeHodStudentsBack(new URL(href, "http://x").searchParams.get("back"))).toBe(list);
  });

  it("is appended after existing query params", () => {
    const href = withHodStudentsBack("/hod/students/abc/attendance?name=A%20B", list);
    const sp = new URL(href, "http://x").searchParams;
    expect(sp.get("name")).toBe("A B");
    expect(sp.get("back")).toBe(list);
  });

  it("does nothing without a list to return to", () => {
    expect(withHodStudentsBack("/hod/students/abc", null)).toBe("/hod/students/abc");
  });

  it("only honours the HOD students list itself", () => {
    expect(safeHodStudentsBack("/hod/students")).toBe("/hod/students");
    expect(safeHodStudentsBack("/hod/students/abc")).toBeNull();
    expect(safeHodStudentsBack("/hod/studentsX")).toBeNull();
    expect(safeHodStudentsBack("https://evil.example/hod/students")).toBeNull();
    expect(safeHodStudentsBack("//evil.example")).toBeNull();
    expect(safeHodStudentsBack("/hod/students?x=\\evil")).toBeNull();
    expect(safeHodStudentsBack("")).toBeNull();
    expect(safeHodStudentsBack(null)).toBeNull();
  });
});
