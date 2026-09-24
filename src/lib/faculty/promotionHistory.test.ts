import { describe, expect, it } from "vitest";
import {
  validatePromotionHistory, runningDesignation, sortPromotionHistory, suggestedNextFromDate,
  normalizePromotionHistory, samePromotionHistory, toDateOnly, addDays,
  type PromotionRow, type PromotionContext,
} from "./promotionHistory";

const ctx: PromotionContext = { joiningDate: "2020-06-01", status: "ACTIVE", today: "2026-09-22" };
const good: PromotionRow[] = [
  { designation: "Assistant Professor", fromDate: "2020-06-01", toDate: "2023-05-31" },
  { designation: "Associate Professor", fromDate: "2023-06-01", toDate: "2025-05-31" },
  { designation: "Professor", fromDate: "2025-06-01" },
];
const msgs = (rows: PromotionRow[], c: PromotionContext = ctx) => validatePromotionHistory(rows, c).map((i) => i.message);

describe("validatePromotionHistory", () => {
  it("accepts the reference example", () => {
    expect(validatePromotionHistory(good, ctx)).toEqual([]);
  });

  it("treats an empty history as valid (nothing recorded)", () => {
    expect(validatePromotionHistory([], ctx)).toEqual([]);
  });

  it("does not care about input order", () => {
    expect(validatePromotionHistory([good[2], good[0], good[1]], ctx)).toEqual([]);
  });

  it("requires a designation and a From Date on every row", () => {
    const m = msgs([{ designation: "", fromDate: "" }]);
    expect(m).toContain("Select a designation.");
    expect(m).toContain("From Date is required.");
  });

  it("rejects duplicate designations, including code vs display name", () => {
    const rows: PromotionRow[] = [
      { designation: "ASSISTANT_PROFESSOR", fromDate: "2020-06-01", toDate: "2023-05-31" },
      { designation: "Assistant Professor", fromDate: "2023-06-01" },
    ];
    const issues = validatePromotionHistory(rows, ctx);
    expect(issues.some((i) => i.row === 1 && /only once/.test(i.message))).toBe(true);
  });

  it("rejects an overlap", () => {
    const rows = [good[0], { ...good[1], fromDate: "2023-05-15" }, good[2]];
    expect(msgs(rows).some((m) => /Overlaps/.test(m))).toBe(true);
  });

  it("rejects a gap and says which date it must start on", () => {
    const rows = [good[0], { ...good[1], fromDate: "2023-07-01" }, good[2]];
    expect(msgs(rows).some((m) => /gap/.test(m) && m.includes("2023-06-01"))).toBe(true);
  });

  it("requires the first period to start on the Date of Joining", () => {
    const rows = [{ ...good[0], fromDate: "2020-07-01" }, ...good.slice(1)];
    expect(msgs(rows).some((m) => /Date of Joining/.test(m))).toBe(true);
    // ...but is not enforced when the joining date is unknown
    expect(validatePromotionHistory(rows, { ...ctx, joiningDate: undefined }).some((i) => /Date of Joining/.test(i.message))).toBe(false);
  });

  it("rejects future dates", () => {
    expect(msgs([{ designation: "Professor", fromDate: "2026-10-01" }], { ...ctx, joiningDate: undefined }))
      .toContain("From Date cannot be in the future.");
    expect(msgs([{ designation: "A", fromDate: "2026-01-01", toDate: "2026-12-31" }, { designation: "B", fromDate: "2027-01-01" }], { ...ctx, joiningDate: undefined }))
      .toContain("To Date cannot be in the future.");
  });

  it("rejects To Date before From Date and malformed dates", () => {
    expect(msgs([{ designation: "A", fromDate: "2020-06-01", toDate: "2020-05-01" }]))
      .toContain("To Date cannot be before From Date.");
    expect(msgs([{ designation: "A", fromDate: "2020-13-45" }])).toContain("From Date is not a valid date.");
  });

  it("allows only the last period to be open", () => {
    const rows = [{ ...good[0], toDate: undefined }, good[1], good[2]];
    const issues = validatePromotionHistory(rows, ctx);
    expect(issues.some((i) => i.row === 0 && /Only the last/.test(i.message))).toBe(true);
  });

  it("requires the last period to be open for a serving faculty member", () => {
    const rows = [good[0], good[1], { ...good[2], toDate: "2026-01-01" }];
    expect(msgs(rows).some((m) => /must not have a To Date/.test(m))).toBe(true);
  });

  it("requires a closed last period for Resigned/Retired, and accepts one", () => {
    for (const status of ["RESIGNED", "RETIRED"]) {
      expect(msgs(good, { ...ctx, status }).some((m) => /has left/.test(m))).toBe(true);
      const closed = [good[0], good[1], { ...good[2], toDate: "2026-06-30" }];
      expect(validatePromotionHistory(closed, { ...ctx, status })).toEqual([]);
    }
  });

  it("allows On Leave and Interview Done to carry a running designation", () => {
    for (const status of ["ON_LEAVE", "INTERVIEW_DONE"]) expect(validatePromotionHistory(good, { ...ctx, status })).toEqual([]);
  });

  it("reports the row indexes of the input order", () => {
    const rows = [good[2], good[0], { ...good[1], fromDate: "2023-07-01" }];
    expect(validatePromotionHistory(rows, ctx).some((i) => i.row === 2 && i.field === "fromDate")).toBe(true);
  });
});

describe("runningDesignation", () => {
  it("is the open period's designation, verbatim", () => {
    expect(runningDesignation(good)).toBe("Professor");
    expect(runningDesignation([{ designation: "ASSISTANT_PROFESSOR", fromDate: "2020-06-01" }])).toBe("ASSISTANT_PROFESSOR");
  });
  it("is the last one held when everything is closed (left the college)", () => {
    expect(runningDesignation([{ designation: "A", fromDate: "2020-01-01", toDate: "2021-01-01" }, { designation: "B", fromDate: "2021-01-02", toDate: "2022-01-01" }])).toBe("B");
  });
  it("is undefined for an empty history", () => {
    expect(runningDesignation([])).toBeUndefined();
  });
});

describe("helpers", () => {
  it("suggests the next From Date", () => {
    expect(suggestedNextFromDate([], "2020-06-01")).toBe("2020-06-01");
    expect(suggestedNextFromDate([good[0]], "2020-06-01")).toBe("2023-06-01");
    expect(suggestedNextFromDate(good, "2020-06-01")).toBeUndefined(); // last one still open
  });
  it("sorts and normalizes for storage without undefined/empty keys", () => {
    const out = normalizePromotionHistory([{ designation: " B ", fromDate: "2021-01-01", toDate: "", promotionOrderUrl: "" }, { designation: "A", fromDate: "2020-01-01", toDate: "2020-12-31" }]);
    expect(out).toEqual([{ designation: "A", fromDate: "2020-01-01", toDate: "2020-12-31" }, { designation: "B", fromDate: "2021-01-01" }]);
    expect(JSON.stringify(out)).not.toContain("undefined");
  });
  it("compares histories ignoring order and blank-vs-missing", () => {
    expect(samePromotionHistory([good[2], good[0], good[1]], good)).toBe(true);
    expect(samePromotionHistory([{ designation: "A", fromDate: "2020-01-01", toDate: "" }], [{ designation: "A", fromDate: "2020-01-01" }])).toBe(true);
    expect(samePromotionHistory(good, [good[0]])).toBe(false);
  });
  it("sorts rows without a usable From Date last", () => {
    expect(sortPromotionHistory([{ designation: "X" }, { designation: "B", fromDate: "2021-01-01" }, { designation: "A", fromDate: "2020-01-01" }]).map((r) => r.designation)).toEqual(["A", "B", "X"]);
  });
  it("turns stored instants into the intended calendar day whichever midnight they were saved at", () => {
    expect(toDateOnly(new Date("2020-06-01T00:00:00Z"))).toBe("2020-06-01"); // UTC midnight (Add form)
    expect(toDateOnly(new Date("2020-05-31T18:30:00Z"))).toBe("2020-06-01"); // IST midnight (CSV import)
    expect(toDateOnly({ toDate: () => new Date("2020-06-01T00:00:00Z") })).toBe("2020-06-01");
    expect(toDateOnly(undefined)).toBeUndefined();
    expect(addDays("2023-05-31", 1)).toBe("2023-06-01");
  });
});
