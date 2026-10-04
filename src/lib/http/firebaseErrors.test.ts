import { describe, expect, it } from "vitest";
import { firebaseAuthErrorResponse } from "./firebaseErrors";

describe("firebaseAuthErrorResponse", () => {
  it("maps known Auth codes to client-safe 4xx responses", async () => {
    const dup = firebaseAuthErrorResponse({ code: "auth/email-already-exists", message: "internal detail" })!;
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "An account with this email already exists" });
    expect(firebaseAuthErrorResponse({ code: "auth/weak-password" })!.status).toBe(400);
    expect(firebaseAuthErrorResponse({ code: "auth/user-not-found" })!.status).toBe(404);
  });
  it("ignores everything else", () => {
    expect(firebaseAuthErrorResponse(new Error("boom"))).toBeNull();
    expect(firebaseAuthErrorResponse({ code: "auth/internal-error" })).toBeNull();
    expect(firebaseAuthErrorResponse(null)).toBeNull();
  });
});
