import { describe, expect, it } from "vitest";
import { getFacultyProfileModules } from "./profileModules";
import { normalizeDisplaySurname, resolveDisplayName } from "./displayName";

describe("display name", () => {
  it("types the surname short form as at most 2 capitals", () => {
    expect(normalizeDisplaySurname("abc")).toBe("AB");
  });
  it("needs both fields, in capitals", () => {
    expect(resolveDisplayName({ displaySurname: "", displayName: "X" }).ok).toBe(false);
    expect(resolveDisplayName({ displaySurname: "av", displayName: "  " }).ok).toBe(false);
    expect(resolveDisplayName({ displaySurname: "ABC", displayName: "X" }).ok).toBe(false);
    expect(resolveDisplayName({ displaySurname: "av", displayName: "venu  gopal" })).toEqual({ ok: true, displaySurname: "AV", displayName: "VENU GOPAL" });
  });
  it("the tile appears only when asked for", () => {
    expect(getFacultyProfileModules().some((m) => m.key === "display-name")).toBe(false);
    expect(getFacultyProfileModules({ includeDisplayName: true }).at(-1)?.key).toBe("display-name");
  });
});
