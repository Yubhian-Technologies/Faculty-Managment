import { describe, expect, it } from "vitest";
import { resolveLogoUrl, DEFAULT_TIMETABLE_LOGO_PATH } from "./logoAsset";

describe("resolveLogoUrl", () => {
  it("defaults to /vishnulogo.png when logoUrl is null or undefined", () => {
    expect(resolveLogoUrl(null)).toContain("/vishnulogo.png");
    expect(resolveLogoUrl(undefined)).toContain("/vishnulogo.png");
  });

  it("defaults to /vishnulogo.png when logoUrl is empty or whitespace", () => {
    expect(resolveLogoUrl("")).toContain("/vishnulogo.png");
    expect(resolveLogoUrl("   ")).toContain("/vishnulogo.png");
  });

  it("defaults to /vishnulogo.png when logoUrl is explicitly /vishnulogo.png", () => {
    expect(resolveLogoUrl("/vishnulogo.png")).toContain("/vishnulogo.png");
  });

  it("preserves custom full URL when provided", () => {
    const customUrl = "https://firebasestorage.googleapis.com/v0/b/bucket/o/logo.png?alt=media";
    expect(resolveLogoUrl(customUrl)).toBe(customUrl);
  });
});
