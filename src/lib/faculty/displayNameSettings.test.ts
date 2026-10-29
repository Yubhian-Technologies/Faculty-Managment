import { describe, expect, it } from "vitest";
import { slotsWithDisplayNames } from "./displayNameApply";
import { displayNameFor, normalizeDisplayNameSettings, readDisplayNameSettings } from "./displayNameSettings";

describe("website display name setting", () => {
  it("is off until ticked, and for unknown / missing data", () => {
    expect(Object.values(readDisplayNameSettings(undefined)).every((v) => v === false)).toBe(true);
    expect(readDisplayNameSettings({ surfaces: { publicProfile: true, other: true } }).publicProfile).toBe(true);
    expect(readDisplayNameSettings({ surfaces: { sectionTimetable: true } }).sectionTimetable).toBe(true);
  });
  it("accepts only known places with true / false", () => {
    expect(normalizeDisplayNameSettings({ publicProfile: true, resume: true })).toMatchObject({ ok: true, surfaces: { publicProfile: true, resume: true, sectionTimetable: false } });
    expect(normalizeDisplayNameSettings({ nope: true }).ok).toBe(false);
    expect(normalizeDisplayNameSettings({ publicProfile: "yes" }).ok).toBe(false);
  });
  it("uses the display name only when ticked and both parts exist", () => {
    const f = { displaySurname: "AV", displayName: "VENU GOPAL" };
    expect(displayNameFor(f, { publicProfile: true }, "publicProfile", "Dr.Venu")).toBe("AV VENU GOPAL");
    expect(displayNameFor(f, { publicProfile: false }, "publicProfile", "Dr.Venu")).toBe("Dr.Venu");
    expect(displayNameFor({ ...f, honorific: "Dr." }, { publicProfile: true }, "publicProfile", "x")).toBe("Dr.AV VENU GOPAL");
  expect(displayNameFor({ displaySurname: "AV" }, { publicProfile: true }, "publicProfile", "Dr.Venu")).toBe("Dr.Venu");
  });
  it("swaps slot faculty for display copies and leaves the stored ones alone", () => {
    const nameFor = (_p: string, ids: { facultyId?: string }, usual: string) => (ids.facultyId === "f1" ? "AV VENU GOPAL" : usual);
    const slots = [{ facultyId: "f1", facultyName: "Dr.Venu" }, { facultyId: "f2", facultyName: "Mr.Ravi" }];
    const out = slotsWithDisplayNames(slots, "sectionTimetable", nameFor);
    expect(out.map((s) => s.facultyName)).toEqual(["AV VENU GOPAL", "Mr.Ravi"]);
    expect(slots[0].facultyName).toBe("Dr.Venu");
    expect(slotsWithDisplayNames([slots[1]], "sectionTimetable", nameFor)).toEqual([slots[1]]);
  });
});
