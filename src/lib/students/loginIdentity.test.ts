import { beforeEach, describe, expect, it } from "vitest";
import {
  rollNumberUpperOf,
  studentLoginEmail,
  studentLoginEmailForRoll,
  studentRollDocId,
  studentRollKey,
} from "@/lib/students/loginDefaults";
import { STUDENT_PASSWORD_MAX_LENGTH, STUDENT_PASSWORD_MIN_LENGTH, studentPasswordError } from "@/lib/students/passwordPolicy";
import { checkRateLimit, clientIp, resetRateLimits } from "@/lib/security/rateLimit";

describe("global student login identity (S3)", () => {
  it("every case / spacing / punctuation variant of a roll is ONE identity - one key, one registry id, one email", () => {
    const variants = ["24PA1A0501", "24pa1a0501", " 24 PA1A0501 ", "24-PA1A0501", "24/PA1A0501", "24.pa1a0501", "24_PA1A0501"];
    expect(new Set(variants.map(studentRollKey)).size).toBe(1);
    expect(new Set(variants.map(studentRollDocId)).size).toBe(1);
    expect(new Set(variants.map(studentLoginEmailForRoll)).size).toBe(1);
  });

  it("the identity has no college in it - the same roll is the same account whichever college asks", () => {
    expect(studentLoginEmailForRoll("24PA1A0501")).toBe("24pa1a0501@students.internal");
    expect(studentRollDocId("24PA1A0501")).toBe("24PA1A0501");
  });

  it("different rolls stay different", () => {
    expect(studentRollKey("24PA1A0501")).not.toBe(studentRollKey("24PA1A0502"));
    expect(studentLoginEmailForRoll("A1")).not.toBe(studentLoginEmailForRoll("A2"));
  });

  it("a roll with no letters or digits has an empty key (callers must reject it)", () => {
    expect(studentRollKey("###")).toBe("");
    expect(studentRollKey("  ")).toBe("");
  });

  it("rollNumberUpper is the trimmed, upper-cased roll and tolerates non-strings", () => {
    expect(rollNumberUpperOf(" 24pa1a0501 ")).toBe("24PA1A0501");
    expect(rollNumberUpperOf(undefined)).toBe("");
    expect(rollNumberUpperOf(42)).toBe("");
  });

  it("the legacy email form is unchanged (existing accounts and the login page's direct try rely on it)", () => {
    expect(studentLoginEmail("24PA1A0501")).toBe("24pa1a0501@students.internal");
    expect(studentLoginEmail(" 24-PA1A0501 ")).toBe("24-pa1a0501@students.internal"); // punctuation kept, unlike the new form
    expect(studentLoginEmail("A/B C")).toBe("abc@students.internal");
  });
});

describe("student password policy (S1)", () => {
  it("accepts a normal password at the minimum and maximum length", () => {
    expect(studentPasswordError("Abcdef12")).toBeNull();
    expect(studentPasswordError("x".repeat(STUDENT_PASSWORD_MIN_LENGTH))).toBeNull();
    expect(studentPasswordError("x".repeat(STUDENT_PASSWORD_MAX_LENGTH))).toBeNull();
    expect(studentPasswordError("pass word with spaces inside")).toBeNull();
  });

  it("rejects missing, non-string, empty, too short and too long passwords", () => {
    for (const bad of [undefined, null, 12345678, {}, [], "", "short"]) expect(studentPasswordError(bad)).toBeTruthy();
    expect(studentPasswordError("x".repeat(STUDENT_PASSWORD_MIN_LENGTH - 1))).toMatch(/at least/);
    expect(studentPasswordError("x".repeat(STUDENT_PASSWORD_MAX_LENGTH + 1))).toMatch(/at most/);
  });

  it("rejects a leading or trailing space (a stray spreadsheet space would silently change the password)", () => {
    expect(studentPasswordError(" Abcdef12")).toMatch(/space/);
    expect(studentPasswordError("Abcdef12 ")).toMatch(/space/);
    expect(studentPasswordError("        ")).toBeTruthy();
  });
});

describe("rate limiter (S2)", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit inside a window, then blocks with a retry hint", () => {
    for (let i = 0; i < 5; i++) expect(checkRateLimit("k", 5, 60_000, 1_000).allowed).toBe(true);
    const blocked = checkRateLimit("k", 5, 60_000, 1_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks keys independently and resets after the window", () => {
    for (let i = 0; i < 6; i++) checkRateLimit("a", 5, 1_000, 0);
    expect(checkRateLimit("a", 5, 1_000, 0).allowed).toBe(false);
    expect(checkRateLimit("b", 5, 1_000, 0).allowed).toBe(true);
    expect(checkRateLimit("a", 5, 1_000, 1_001).allowed).toBe(true); // new window
  });

  it("takes the caller address from x-forwarded-for, first hop", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } });
    expect(clientIp(req)).toBe("1.2.3.4");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});
