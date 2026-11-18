import { describe, expect, it } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";
import { EMBEDDING_LENGTH } from "./faceThreshold";
import { verifyAttendanceProof } from "./attendanceProof";
import { allowsFace, allowsPasskey, relyingParty, selfCheckInMethod, verifyAttendancePasskey, PasskeyError } from "./passkeys";

const C = "colleges/c1";
const face = Array.from({ length: EMBEDDING_LENGTH }, () => 0);
const db = (method?: string) => new FakeFirestore({
  [`${C}/facultyMembers/f1`]: { userUid: "u1", faceEmbedding: face },
  ...(method ? { [`${C}/settings/selfCheckIn`]: { method } } : {}),
  [`${C}/passkeys/cred1`]: { uid: "u1", publicKey: "AA", counter: 0, label: "Pixel" },
}) as unknown as FirebaseFirestore.Firestore;
const req = new Request("https://people.example.edu/api/x", { headers: { host: "people.example.edu" } });
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
const reqFrom = (ua: string) => new Request("https://people.example.edu/api/x", { headers: { host: "people.example.edu", "user-agent": ua } });

describe("self check-in method", () => {
  it("defaults to the face scan; EITHER allows both", async () => {
    expect(await selfCheckInMethod(db(), "c1")).toBe("FACE");
    expect(await selfCheckInMethod(db("BOGUS"), "c1")).toBe("FACE");
    expect(allowsFace("EITHER") && allowsPasskey("EITHER")).toBe(true);
    expect(allowsPasskey("FACE") || allowsFace("PASSKEY")).toBe(false);
  });

  it("FACE college: a passkey proof is refused; PASSKEY college: a face proof is refused", async () => {
    const now = Date.now();
    const pk = await verifyAttendanceProof(db("FACE"), "c1", "u1", { passkey: { id: "cred1" }, accuracy: 10 }, now, req);
    expect(pk).toMatchObject({ ok: false, status: 400 });
    const fc = await verifyAttendanceProof(db("PASSKEY"), "c1", "u1", { faceDescriptor: face, capturedAt: now, accuracy: 10 }, now, req);
    expect(fc).toMatchObject({ ok: false, status: 400 });
    // The face scan still works where it's allowed.
    expect(await verifyAttendanceProof(db("EITHER"), "c1", "u1", { faceDescriptor: face, capturedAt: now, accuracy: 10 }, now, req)).toMatchObject({ ok: true });
  });

  it("an imprecise location is refused for a passkey too", async () => {
    const r = await verifyAttendanceProof(db("PASSKEY"), "c1", "u1", { passkey: { id: "cred1" }, accuracy: 900 }, Date.now(), req);
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("a passkey of someone else, or with no open challenge, is refused before any signature check", async () => {
    await expect(verifyAttendancePasskey(db("PASSKEY"), "c1", "u2", { id: "cred1" } as never, req)).rejects.toMatchObject({ status: 403 });
    await expect(verifyAttendancePasskey(db("PASSKEY"), "c1", "u1", { id: "cred1" } as never, req)).rejects.toBeInstanceOf(PasskeyError);
  });

  it("the relying party follows the site the request came to", () => {
    expect(relyingParty(req)).toEqual({ rpID: "people.example.edu", origin: "https://people.example.edu" });
    expect(relyingParty(new Request("http://localhost:3000/x", { headers: { host: "localhost:3000" } }))).toEqual({ rpID: "localhost", origin: "http://localhost:3000" });
  });
});

describe("changing the registration is the HOD's reset, not self-service", () => {
  it("a second phone is refused", async () => {
    const { registrationOptions } = await import("./passkeys");
    await expect(registrationOptions(db("PASSKEY"), "c1", "u1", "u1@x", req)).rejects.toMatchObject({ status: 409 });
  });

  it("the report flags a check-in made with a fresh registration", async () => {
    const { checkInHowOf, isNewRegistration } = await import("./checkInHow");
    const now = Date.now();
    expect(isNewRegistration(new Date(now - 86_400_000), now)).toBe(true);
    expect(isNewRegistration(new Date(now - 4 * 86_400_000), now)).toBe(false);
    expect(checkInHowOf({ checkInProof: { method: "PASSKEY", deviceLabel: "Pixel", newRegistration: true } })).toEqual({ method: "PASSKEY", device: "Pixel", newDevice: true });
    expect(checkInHowOf({ checkInProof: { method: "SERVER_DESCRIPTOR_MATCH" } })).toEqual({ method: "FACE" });
    expect(checkInHowOf({})).toBeNull();
  });
});

describe("only the registered phone itself signs a check-in (not a laptop's synced copy)", () => {
  it("tells phones from computers", async () => {
    const { deviceKindOf } = await import("./passkeyDevice");
    const h = (ua: string, extra: Record<string, string> = {}) => new Headers({ "user-agent": ua, ...extra });
    expect(deviceKindOf(h(IPHONE))).toBe("PHONE");
    expect(deviceKindOf(h("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130 Mobile Safari/537.36"))).toBe("PHONE");
    expect(deviceKindOf(h(MAC))).toBe("COMPUTER");
    expect(deviceKindOf(h("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130"))).toBe("COMPUTER");
    expect(deviceKindOf(h("Mozilla/5.0 (Linux; Android 14; Tab) Chrome/130 Safari/537.36"))).toBe("COMPUTER");
    // iPhone / iPad Safari asking for the desktop site sends a Mac User-Agent, but has a touch screen.
    expect(deviceKindOf(h(MAC), 5)).toBe("PHONE");
    expect(deviceKindOf(h(MAC, { "sec-ch-ua-mobile": "?1" }))).toBe("PHONE");
  });

  it("a computer's own copy is refused; the phone itself or the phone via QR is accepted", async () => {
    const { passkeyRouteOf } = await import("./passkeyDevice");
    expect(passkeyRouteOf("platform", "COMPUTER")).toBeNull();
    expect(passkeyRouteOf(undefined, "COMPUTER")).toBeNull();
    expect(passkeyRouteOf("cross-platform", "COMPUTER")).toBe("NEARBY_PHONE");
    expect(passkeyRouteOf("platform", "PHONE")).toBe("ON_PHONE");
    expect(passkeyRouteOf(undefined, "PHONE")).toBe("ON_PHONE");
  });

  it("the check-in itself refuses a laptop's copy before any signature check", async () => {
    const r = await verifyAttendanceProof(db("PASSKEY"), "c1", "u1", { passkey: { id: "cred1", authenticatorAttachment: "platform" }, accuracy: 30 }, Date.now(), reqFrom(MAC));
    expect(r).toMatchObject({ ok: false, status: 403 });
    // From the phone it goes on to the signature check (which this fake key fails - 403 from the passkey, not the device rule).
    const onPhone = await verifyAttendanceProof(db("PASSKEY"), "c1", "u1", { passkey: { id: "cred1", authenticatorAttachment: "platform" }, accuracy: 30 }, Date.now(), reqFrom(IPHONE));
    expect(onPhone.ok ? "" : onPhone.error).not.toMatch(/computer/);
  });

  it("a computer can't register, and is sent straight to the phone's QR code", async () => {
    const { registrationOptions, authenticationOptions } = await import("./passkeys");
    const empty = new FakeFirestore({}) as unknown as FirebaseFirestore.Firestore;
    await expect(registrationOptions(empty, "c1", "u1", "u1@x", reqFrom(MAC), "COMPUTER")).rejects.toMatchObject({ status: 400 });
    const opts = await authenticationOptions(db("PASSKEY"), "c1", "u1", reqFrom(MAC), "COMPUTER") as { hints?: string[]; allowCredentials?: { transports?: string[] }[] };
    expect(opts.hints).toEqual(["hybrid"]);
    expect(opts.allowCredentials?.[0].transports).toEqual(["hybrid"]);
  });

  it("the report marks a check-in made through a computer", async () => {
    const { checkInHowOf } = await import("./checkInHow");
    expect(checkInHowOf({ checkInProof: { method: "PASSKEY", deviceLabel: "iPhone", route: "NEARBY_PHONE" } })).toEqual({ method: "PASSKEY", device: "iPhone", viaComputer: true });
  });
});
