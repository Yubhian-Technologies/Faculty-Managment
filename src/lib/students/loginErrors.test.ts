import { describe, expect, it } from "vitest";
import { describeLoginFailure } from "./loginErrors";

describe("describeLoginFailure", () => {
  it("maps known Firebase codes to actionable messages", () => {
    expect(describeLoginFailure({ code: "auth/invalid-email" })).toMatchObject({ status: 400, code: "auth/invalid-email" });
    expect(describeLoginFailure({ errorInfo: { code: "auth/insufficient-permission" } }).message).toMatch(/service account/);
    expect(describeLoginFailure({ code: 8, message: "RESOURCE_EXHAUSTED" }).status).toBe(503);
    expect(describeLoginFailure({ code: "auth/operation-not-allowed" }).message).toMatch(/isn't enabled/);
  });
  it("never echoes the raw message for unknown errors", () => {
    const f = describeLoginFailure(new Error("secret-project-123 exploded"));
    expect(f.message).not.toContain("secret-project-123");
    expect(f.code).toBe("unknown");
  });
});
