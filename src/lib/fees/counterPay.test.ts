import { describe, expect, it } from "vitest";
import { counterPayUrl, counterState, counterTokenOk } from "./counterPay";

const counter = (o: Partial<{ expiresAt: string; cancelledAt: string | null }> = {}) => ({ byUid: "u", byName: "Office", token: "a".repeat(32), expiresAt: "2026-11-28T10:30:00.000Z", cancelledAt: null, ...o });
const at = new Date("2026-11-28T10:10:00.000Z");

describe("fee counter payment (CCAvenue QR)", () => {
  it("is open until paid, failed, cancelled or 30 minutes up", () => {
    expect(counterState({ status: "INITIATED", counter: counter() }, at)).toBe("READY");
    expect(counterState({ status: "INITIATED", counter: counter() }, new Date("2026-11-28T10:31:00.000Z"))).toBe("EXPIRED");
    expect(counterState({ status: "INITIATED", counter: counter({ cancelledAt: "2026-11-28T10:05:00.000Z" }) }, at)).toBe("CANCELLED");
    expect(counterState({ status: "SUCCESS", counter: counter({ cancelledAt: "2026-11-28T10:05:00.000Z" }) }, at)).toBe("PAID");
    expect(counterState({ status: "ABORTED", counter: counter() }, at)).toBe("FAILED");
    expect(counterState({ status: "REFUNDED", counter: counter() }, at)).toBe("REFUNDED");
  });
  it("opens only with the payment's own token", () => {
    const t = "f".repeat(32);
    expect(counterTokenOk(t, t)).toBe(true);
    expect(counterTokenOk(t, "e".repeat(32))).toBe(false);
    expect(counterTokenOk(t, null)).toBe(false);
    expect(counterTokenOk(t, t.slice(1))).toBe(false);
    expect(counterTokenOk(undefined, t)).toBe(false);
  });
  it("builds the QR link on the app's own address", () => {
    expect(counterPayUrl("https://www.vishnupeople.in", "c3a1", "FMSX1", "k1")).toBe("https://www.vishnupeople.in/pay/c3a1/FMSX1?k=k1");
  });
});
