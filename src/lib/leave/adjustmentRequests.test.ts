import { describe, expect, it } from "vitest";
import { withdrawSupersededPeriods } from "./adjustmentRequests";
import type { AdjustmentRequest } from "@/types/leave";

// Reassigning coverage used to leave the previous substitute PENDING on
// periods someone else had taken over - two people asked to cover the same
// slot, and whoever accepted second silently double-booked it.

const P = (n: number, status: "PENDING" | "ACCEPTED" | "DECLINED" = "PENDING") =>
  ({ date: "2026-09-01", timetableSlotId: `slot${n}`, status });
const key = (n: number) => `2026-09-01|slot${n}`;

const sub = (uid: string, periods: ReturnType<typeof P>[]): AdjustmentRequest => ({
  kind: "SUBSTITUTE", assigneeUid: uid, assigneeName: uid,
  assigneeFacultyId: `fac-${uid}`, periods, status: "PENDING",
});

describe("withdrawSupersededPeriods", () => {
  it("takes reassigned periods off the previous substitute", () => {
    const out = withdrawSupersededPeriods(
      [sub("ravi", [P(1), P(2), P(3)]), sub("pradeep", [P(1), P(2)])],
      "pradeep",
      new Set([key(1), key(2)])
    );
    expect(out.find((a) => a.assigneeUid === "ravi")?.periods?.map((p) => p.timetableSlotId)).toEqual(["slot3"]);
  });

  it("leaves the new assignee's own periods alone", () => {
    const out = withdrawSupersededPeriods(
      [sub("ravi", [P(1)]), sub("pradeep", [P(1)])],
      "pradeep",
      new Set([key(1)])
    );
    expect(out.find((a) => a.assigneeUid === "pradeep")?.periods).toHaveLength(1);
  });

  it("drops an entry whose periods were all taken over", () => {
    const out = withdrawSupersededPeriods(
      [sub("ravi", [P(1), P(2)]), sub("pradeep", [P(1), P(2)])],
      "pradeep",
      new Set([key(1), key(2)])
    );
    expect(out.map((a) => a.assigneeUid)).toEqual(["pradeep"]);
  });

  it("withdraws periods the previous substitute had already accepted", () => {
    const out = withdrawSupersededPeriods(
      [sub("ravi", [P(1, "ACCEPTED"), P(2)]), sub("pradeep", [P(1)])],
      "pradeep",
      new Set([key(1)])
    );
    expect(out.find((a) => a.assigneeUid === "ravi")?.periods?.map((p) => p.timetableSlotId)).toEqual(["slot2"]);
  });

  it("recomputes the status of what remains", () => {
    // slot1 was the only PENDING one; once it moves away, everything left is
    // settled, so the entry is no longer blocking the request.
    const out = withdrawSupersededPeriods(
      [sub("ravi", [P(1), P(2, "ACCEPTED")]), sub("pradeep", [P(1)])],
      "pradeep",
      new Set([key(1)])
    );
    expect(out.find((a) => a.assigneeUid === "ravi")?.status).toBe("ACCEPTED");
  });

  it("never touches a HANDOVER entry, which carries no periods", () => {
    const handover: AdjustmentRequest = {
      kind: "HANDOVER", assigneeUid: "meena", assigneeName: "meena", status: "PENDING",
    };
    const out = withdrawSupersededPeriods([handover, sub("pradeep", [P(1)])], "pradeep", new Set([key(1)]));
    expect(out).toContainEqual(handover);
  });

  it("leaves an untouched substitute exactly as it was", () => {
    const other = sub("divya", [P(9)]);
    const out = withdrawSupersededPeriods([other, sub("pradeep", [P(1)])], "pradeep", new Set([key(1)]));
    expect(out).toContainEqual(other);
  });
});
