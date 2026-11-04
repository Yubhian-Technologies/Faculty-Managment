import { beforeEach, describe, expect, it, vi } from "vitest";

// The configurable certificate flow end to end, against a small in-memory Firestore: the starter catalogue
// installs once, a student applies, approvers decide in order (one, then several at once), a step sends it back
// and the student corrects it, the issuer issues (number, frozen copy, register, QR record), the copy is read
// back, and revoking marks the register and the QR check.

vi.mock("@/lib/notify", () => ({ notify: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/safeAuditLog", () => ({ writeAuditLogSafe: vi.fn(async () => true) }));
vi.mock("@/lib/notifications/workflowNotifications", () => ({
  emitWorkflowNotification: vi.fn(async () => undefined), resolveWorkflowNotifications: vi.fn(async () => undefined),
}));
vi.mock("@/lib/college/collegeAcademicYear", () => ({ resolveCollegeAcademicYear: async () => "2026-27" }));
vi.mock("@/lib/examResults/store", () => ({ loadResultRules: async () => ({ rules: { showSgpa: "ALWAYS", showCgpa: "ALWAYS", decimals: 2 } }) }));
vi.mock("@/lib/examResults/studentSittings", () => ({ loadPublishedSittings: async () => [] }));
// Who holds each role (the real lookup reads users + seats).
const ROLE_HOLDERS: Record<string, string[]> = { HOD: ["u-hod"], PRINCIPAL: ["u-prin"], COLLEGE_OFFICE: ["u-office"], LIBRARY: ["u-lib"], HOSTEL: ["u-hostel"], PLACEMENT_DEPT: ["u-place"], PD: ["u-pd"], EXAM_CELL: ["u-exam"] };
vi.mock("@/lib/roles/findUsersByRoles", () => ({ findUsersByRoles: async (_db: unknown, _c: string, roles: string[]) => roles.flatMap((r) => (ROLE_HOLDERS[r] ?? []).map((id) => ({ id }))) }));
vi.mock("@/lib/departments/scope", () => ({
  getHodDepartmentScope: async () => ({ departments: ["CSE"] }),
  canHodEditDepartment: (scope: { departments: string[] }, d: string) => scope.departments.includes(d),
}));

// ─── In-memory Firestore (just what the flow uses) ──────────────────────────────────
type Data = Record<string, unknown>;
const store = new Map<string, Data>();
let auto = 0;
const clone = <T,>(v: T): T => structuredClone(v);
const getField = (d: Data | undefined, path: string) => path.split(".").reduce<unknown>((o, k) => (o as Data | undefined)?.[k], d);
const snap = (path: string) => {
  const data = store.get(path);
  return { exists: data !== undefined, id: path.split("/").pop()!, ref: docRef(path), data: () => (data ? clone(data) : undefined), get: (f: string) => getField(data, f) };
};
function docRef(path: string): Data {
  return {
    path, id: path.split("/").pop()!,
    get: async () => snap(path),
    set: async (d: Data, o?: { merge?: boolean }) => { store.set(path, o?.merge ? { ...(store.get(path) ?? {}), ...clone(d) } : clone(d)); },
    update: async (d: Data) => { store.set(path, { ...(store.get(path) ?? {}), ...clone(d) }); },
    delete: async () => { store.delete(path); },
    collection: (n: string) => colRef(`${path}/${n}`),
  };
}
function query(path: string, filters: [string, string, unknown][], lim?: number, order?: [string, string]): Data {
  const run = () => {
    let rows = [...store.keys()].filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes("/")).map((k) => snap(k));
    for (const [f, op, v] of filters) {
      rows = rows.filter((r) => { const x = getField(r.data(), f); return op === "array-contains" ? Array.isArray(x) && x.includes(v) : x === v; });
    }
    if (order) rows.sort((a, b) => String(getField(a.data(), order[0])).localeCompare(String(getField(b.data(), order[0]))) * (order[1] === "desc" ? -1 : 1));
    if (lim) rows = rows.slice(0, lim);
    return { docs: rows, empty: rows.length === 0, size: rows.length };
  };
  return {
    where: (f: string, op: string, v: unknown) => query(path, [...filters, [f, op, v]], lim, order),
    limit: (n: number) => query(path, filters, n, order),
    orderBy: (f: string, dir = "asc") => query(path, filters, lim, [f, dir]),
    select: () => query(path, filters, lim, order),
    get: async () => run(),
  };
}
function colRef(path: string): Data {
  return {
    ...query(path, []),
    doc: (id?: string) => docRef(`${path}/${id ?? `auto${++auto}`}`),
    add: async (d: Data) => { const id = `auto${++auto}`; store.set(`${path}/${id}`, clone(d)); return docRef(`${path}/${id}`); },
  };
}
const writer = (writes: (() => void)[]) => ({
  get: async (ref: { path: string }) => snap(ref.path),
  set: (ref: { path: string }, d: Data, o?: { merge?: boolean }) => writes.push(() => store.set(ref.path, o?.merge ? { ...(store.get(ref.path) ?? {}), ...clone(d) } : clone(d))),
  create: (ref: { path: string }, d: Data) => { if (store.has(ref.path)) throw new Error(`ALREADY_EXISTS ${ref.path}`); writes.push(() => store.set(ref.path, clone(d))); },
  update: (ref: { path: string }, d: Data) => { if (!store.has(ref.path)) throw new Error(`NOT_FOUND ${ref.path}`); writes.push(() => store.set(ref.path, { ...(store.get(ref.path) ?? {}), ...clone(d) })); },
});
const db = {
  collection: (n: string) => colRef(n),
  getAll: async (...refs: { path: string }[]) => refs.map((r) => snap(r.path)),
  batch: () => { const writes: (() => void)[] = []; return { ...writer(writes), commit: async () => writes.forEach((w) => w()) }; },
  runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>) => { const writes: (() => void)[] = []; const out = await fn(writer(writes)); writes.forEach((w) => w()); return out; },
};

const { installStarterCatalog, typesCol } = await import("./store");
const { submitConfigured, issueConfigured, previewIssue, readIssuedDocument, revokeIssued, studentCatalog } = await import("./configured");
const { decide, returnRequest, resubmit, getRequest } = await import("./service");

const C = "c1";
const actor = (uid: string, role: string) => ({ uid, name: uid, collegeId: C, role });
const STUDENT = actor("u-stu", "STUDENT");
const D = db as never;

beforeEach(async () => {
  store.clear(); auto = 0;
  store.set(`colleges/${C}`, { name: "Test College", address: "Bhimavaram" });
  store.set(`colleges/${C}/students/s1`, {
    uid: "u-stu", name: "Ravi Kumar", rollNumber: "22A31A0501", department: "CSE", year: 3, section: "A", status: "REGULAR",
    gender: "Male", fatherName: "Suresh", course: "B.Tech", mentorUid: "u-mentor",
  });
  for (const u of ["u-hod", "u-prin", "u-office", "u-lib", "u-hostel", "u-place", "u-pd", "u-exam", "u-mentor"]) store.set(`colleges/${C}/users/${u}`, { name: u, isActive: true });
  await installStarterCatalog(D, C, "Principal");
});

describe("starter catalogue", () => {
  it("installs once and never overwrites an edited type", async () => {
    await typesCol(D, C).doc("bonafide").update({ name: "Bonafide (edited)" });
    expect(await installStarterCatalog(D, C, "Principal")).toEqual({ types: 0, templates: 0 });
    expect(store.get(`colleges/${C}/certificateTypes/bonafide`)?.name).toBe("Bonafide (edited)");
  });

  it("students see only switched-on types (No Dues on install)", async () => {
    const { entries } = await studentCatalog(D, STUDENT);
    expect(entries.map((e) => e.type.id)).toEqual(["no_dues"]);
  });
});

describe("apply -> approve -> return -> correct -> issue -> verify -> revoke", () => {
  it("runs the whole flow", async () => {
    await typesCol(D, C).doc("bonafide").update({ isActive: true });
    await expect(submitConfigured(D, STUDENT, { typeId: "bonafide", purpose: "Nope" })).rejects.toThrow(/purpose/i);
    const { request } = await submitConfigured(D, STUDENT, { typeId: "bonafide", purpose: "Passport" });
    expect(request.status).toBe("IN_PROGRESS");
    expect(request.pendingRecipientUids).toEqual(["u-hod"]);
    // A second application while one is open returns the open one.
    expect((await submitConfigured(D, STUDENT, { typeId: "bonafide", purpose: "Passport" })).alreadyExists).toBe(true);

    // The Principal can't act on the HOD's step.
    await expect(decide(D, actor("u-prin", "PRINCIPAL"), request.id, "APPROVE")).rejects.toThrow();
    let r = await decide(D, actor("u-hod", "HOD"), request.id, "APPROVE");
    expect(r.pendingRecipientUids).toEqual(["u-prin"]);

    // Sent back by the Principal; the student corrects it and it returns to the Principal.
    await expect(returnRequest(D, actor("u-prin", "PRINCIPAL"), request.id, "")).rejects.toThrow(/correct/);
    r = await returnRequest(D, actor("u-prin", "PRINCIPAL"), request.id, "Pick Employment instead");
    expect(r.status).toBe("RETURNED");
    expect(r.pendingRecipientUids).toEqual([]);
    r = await resubmit(D, STUDENT, request.id, { purpose: "Employment" });
    expect(r.status).toBe("IN_PROGRESS");
    expect(r.purpose).toBe("Employment");
    expect(r.pendingRecipientUids).toEqual(["u-prin"]);

    r = await decide(D, actor("u-prin", "PRINCIPAL"), request.id, "APPROVE");
    expect(r.status).toBe("PENDING_ISSUANCE");
    expect(r.pendingRecipientUids).toEqual(["u-office"]);

    const preview = await previewIssue(D, actor("u-office", "COLLEGE_OFFICE"), request.id, {}, "https://app.test");
    expect(preview.html).toContain("Ravi Kumar");
    expect(preview.html).toContain("PREVIEW");

    const issued = await issueConfigured(D, actor("u-office", "COLLEGE_OFFICE"), request.id, {}, "https://app.test");
    expect(issued.status).toBe("ISSUED");
    expect(issued.certificateNumber).toBe(`BON/${new Date().getFullYear()}/0001`);
    const reg = store.get(`colleges/${C}/issuedCertificates/${request.id}`)!;
    expect(reg).toMatchObject({ certificateNumber: issued.certificateNumber, studentRollNumber: "22A31A0501", revoked: null });
    const code = reg.verificationCode as string;
    expect(store.get(`certificateVerifications/${code}`)).toMatchObject({ collegeId: C, certificateNumber: issued.certificateNumber, revoked: null });

    // The frozen copy: the student reads it, another student can't.
    const doc = await readIssuedDocument(D, STUDENT, request.id);
    expect(doc.html).toContain(issued.certificateNumber!);
    expect(doc.html).toContain(`/verify-certificate/${code}`);
    expect(doc.html).toContain("Mr.");
    await expect(readIssuedDocument(D, actor("u-other", "STUDENT"), request.id)).rejects.toThrow(/not found/i);

    // Issuing again is refused; the next one of the type takes the next number.
    await expect(issueConfigured(D, actor("u-office", "COLLEGE_OFFICE"), request.id, {}, "https://app.test")).rejects.toThrow();

    const revoked = await revokeIssued(D, actor("u-prin", "PRINCIPAL"), request.id, "Issued by mistake");
    expect(revoked.revoked?.reason).toBe("Issued by mistake");
    expect((store.get(`certificateVerifications/${code}`)?.revoked as { reason: string }).reason).toBe("Issued by mistake");
    expect((await getRequest(D, STUDENT, request.id)).history.at(-1)?.action).toBe("REVOKED");
  });

  it("No Dues: every department of the parallel step must approve, any can send it back", async () => {
    const { request } = await submitConfigured(D, STUDENT, { typeId: "no_dues" });
    let r = await decide(D, actor("u-hod", "HOD"), request.id, "APPROVE");
    expect(new Set(r.pendingRecipientUids)).toEqual(new Set(["u-lib", "u-hostel", "u-place", "u-pd"]));
    r = await decide(D, actor("u-lib", "LIBRARY"), request.id, "APPROVE", undefined, "LIBRARY");
    expect(r.pendingRecipientUids).not.toContain("u-lib");
    r = await returnRequest(D, actor("u-hostel", "HOSTEL"), request.id, "Hostel fee receipt missing", "HOSTEL");
    expect(r.status).toBe("RETURNED");
    r = await resubmit(D, STUDENT, request.id, {});
    // Back to the approvals still open - the Library's stays approved.
    expect(new Set(r.pendingRecipientUids)).toEqual(new Set(["u-hostel", "u-place", "u-pd"]));
    for (const [uid, key] of [["u-hostel", "HOSTEL"], ["u-place", "PLACEMENT_DEPT"], ["u-pd", "PD"]]) r = await decide(D, actor(uid, key), request.id, "APPROVE", undefined, key);
    expect(r.pendingRecipientUids).toEqual(["u-office"]);
    r = await decide(D, actor("u-office", "COLLEGE_OFFICE"), request.id, "APPROVE");
    expect(r.status).toBe("PENDING_ISSUANCE");
  });

  it("a fee must have its receipt, an issuer field is required, and a once-only type can't be applied for again", async () => {
    await typesCol(D, C).doc("tc").update({ isActive: true, eligibility: { statuses: [], years: [] }, flow: [{ id: "p", type: "SEQUENTIAL", label: "Principal", recipient: { kind: "ROLE", role: "PRINCIPAL" } }], feeAmount: 200 });
    const { request } = await submitConfigured(D, STUDENT, { typeId: "tc" });
    await decide(D, actor("u-prin", "PRINCIPAL"), request.id, "APPROVE");
    const office = actor("u-office", "COLLEGE_OFFICE");
    await expect(issueConfigured(D, office, request.id, { issuerValues: {} }, "https://app.test")).rejects.toThrow(/Date of leaving/);
    const full = { dateOfLeaving: "2026-05-31", classAtLeaving: "IV B.Tech", qualifiedForPromotion: "Yes" };
    await expect(issueConfigured(D, office, request.id, { issuerValues: full }, "https://app.test")).rejects.toThrow(/receipt/);
    const done = await issueConfigured(D, office, request.id, { issuerValues: full, feeReceiptNo: "R-77" }, "https://app.test");
    expect(done.feeReceiptNo).toBe("R-77");
    expect((await readIssuedDocument(D, office, request.id)).html).toContain("31-05-2026");
    await expect(submitConfigured(D, STUDENT, { typeId: "tc" })).rejects.toThrow(/only once/);
  });

  it("the mentor step goes to the student's own mentor", async () => {
    await typesCol(D, C).doc("recommendation").update({ isActive: true });
    const { request } = await submitConfigured(D, STUDENT, { typeId: "recommendation", purpose: "Employment", values: { addressedTo: "ACME Ltd" } });
    expect(request.pendingRecipientUids).toEqual(["u-mentor"]);
  });
});
