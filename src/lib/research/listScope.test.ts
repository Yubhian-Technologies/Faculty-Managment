import { describe, expect, it } from "vitest";
import { wantsWholeCollege } from "./listScope";

const req = (url: string) => new Request(`http://x${url}`);

describe("wantsWholeCollege", () => {
  // The reported bug: the R&D head opened their OWN /panel/profile/research
  // and got the whole college's Research Profiles, so another person's pending
  // record rendered as theirs - "Pending Verification" and an Edit button on
  // somebody else's data.
  it("is false for an own-profile read, R&D or not", () => {
    expect(wantsWholeCollege(req("/api/college/research-profile"), true)).toBe(false);
    expect(wantsWholeCollege(req("/api/college/research-profile"), false)).toBe(false);
  });

  it("is true only when the review page asks and the caller holds the seat", () => {
    expect(wantsWholeCollege(req("/api/college/research-profile?scope=all"), true)).toBe(true);
    expect(wantsWholeCollege(req("/api/college/research-profile?scope=all"), false)).toBe(false);
  });

  it("ignores anything else in the query", () => {
    expect(wantsWholeCollege(req("/api/college/innovations?uid=abc"), true)).toBe(false);
    expect(wantsWholeCollege(req("/api/college/innovations?scope=mine"), true)).toBe(false);
    expect(wantsWholeCollege(req("/api/college/innovations?scope=ALL"), true)).toBe(false);
  });
});
