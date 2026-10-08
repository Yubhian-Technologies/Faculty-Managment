import { describe, expect, it } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";
import { hasOpenDraftToday } from "./openDraft";

// 2026-10-07 12:00 IST
const NOW = new Date("2026-10-07T06:30:00Z");
const C = "colleges/c1/studentAttendance";
const doc = (over: Record<string, unknown>) => ({ assignmentId: "a1", status: "DRAFT", date: "2026-10-07", periodNumber: 2, ...over });

describe("hasOpenDraftToday", () => {
  it("is true for today's unsubmitted session of that assignment", async () => {
    const db = new FakeFirestore({ [`${C}/a1_2026-10-07_2`]: doc({}) }) as unknown as FirebaseFirestore.Firestore;
    expect(await hasOpenDraftToday(db, "c1", "a1", undefined, NOW)).toBe(true);
    expect(await hasOpenDraftToday(db, "c1", "a1", 2, NOW)).toBe(true);
  });

  it("ignores another period, another assignment, a submitted session and an old draft", async () => {
    const db = new FakeFirestore({
      [`${C}/x1`]: doc({ periodNumber: 3 }),
      [`${C}/x2`]: doc({ assignmentId: "a2" }),
      [`${C}/x3`]: doc({ status: "SUBMITTED" }),
      [`${C}/x4`]: doc({ date: "2026-10-06" }),
    }) as unknown as FirebaseFirestore.Firestore;
    expect(await hasOpenDraftToday(db, "c1", "a1", 2, NOW)).toBe(false);
  });
});
