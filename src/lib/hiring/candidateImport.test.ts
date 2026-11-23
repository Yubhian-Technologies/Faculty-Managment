import { describe, expect, it } from "vitest";
import { checkRows, matchHeaders, normalizeMobile, type ImportRow } from "./candidateImport";

const row = (over: Partial<ImportRow> = {}): ImportRow => ({ name: "Ravi Kumar", email: "Ravi@Mail.com", mobile: "9848012345", source: "", referredBy: "", address: "", ...over });

describe("candidate import", () => {
  it("matches headers by name, any case / spacing, and names missing ones", () => {
    expect(matchHeaders(["Candidate Name", "Email ID", "Mobile No", "Source"]).error).toBeUndefined();
    expect(matchHeaders(["Name", "Email"]).error).toBe("The sheet needs these columns: Mobile.");
  });

  it("normalizes mobiles", () => {
    expect(normalizeMobile("+91 98480-12345")).toBe("9848012345");
    expect(normalizeMobile("09848012345")).toBe("9848012345");
  });

  it("accepts a good row with Advertisement by default and lower-cases the email", () => {
    const [r] = checkRows([row()], []);
    expect(r).toEqual({ row: 2, ok: true, candidate: { name: "Ravi Kumar", email: "ravi@mail.com", phone: "9848012345", source: "ADVERTISEMENT" } });
  });

  it("refuses bad values, duplicates in the file and candidates already in the pool", () => {
    const res = checkRows([
      row(),
      row({ name: "Other", email: "x@y.in" }),
      row({ name: "", mobile: "9000000001", email: "a@b.in" }),
      row({ mobile: "12345", email: "c@d.in" }),
      row({ email: "pool@x.in", mobile: "9000000002" }),
      row({ email: "new@x.in", mobile: "9000000003", source: "Referral", referredBy: "Dr. Rao" }),
    ], [{ id: "c1", name: "Pooled", email: "pool@x.in" }]);
    expect(res.map((r) => (r.ok ? "ok" : r.reason))).toEqual([
      "ok",
      "Same mobile as row 2 of this file.",
      "Enter the candidate's name.",
      "Enter a 10-digit mobile number starting 6-9.",
      "Already a candidate (Pooled). Attach them from Candidates instead.",
      "ok",
    ]);
    expect(res[5].ok && res[5].candidate.referralName).toBe("Dr. Rao");
  });
});
