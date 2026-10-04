import { beforeEach, describe, expect, it } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";
import { attendanceDateKeysReady, clearAttendanceDateKeyCache } from "./dateKeys";

describe("attendanceDateKeysReady", () => {
  beforeEach(() => clearAttendanceDateKeyCache());

  it("is false until the backfill marker exists", async () => {
    const fake = new FakeFirestore();
    expect(await attendanceDateKeysReady(asFirestore(fake).collection("colleges").doc("c1"))).toBe(false);
  });

  it("is true once the marker says backfilled", async () => {
    const fake = new FakeFirestore();
    fake.seed("colleges/c1/counters/attendanceDateKeys", { backfilled: true });
    expect(await attendanceDateKeysReady(asFirestore(fake).collection("colleges").doc("c1"))).toBe(true);
  });
});
