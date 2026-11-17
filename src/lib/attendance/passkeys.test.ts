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
