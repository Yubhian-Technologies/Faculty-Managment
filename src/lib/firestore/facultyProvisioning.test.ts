import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/firebase/authRest", () => ({ createFirebaseUser: vi.fn(async () => "new-uid") }));

import { provisionFacultyFromOffer, linkFacultyToExistingAccount } from "./facultyProvisioning";

// Minimal in-memory stand-in for the Admin SDK surface the provisioning helpers use.
function fakeDb(docs: Record<string, Record<string, unknown>>) {
  const writes: { path: string; data: Record<string, unknown> }[] = [];
  let auto = 0;
  const docRef = (path: string): unknown => ({
    id: path.split("/").pop(),
    get: async () => ({ exists: path in docs, data: () => docs[path] }),
    set: async (data: Record<string, unknown>) => { writes.push({ path, data }); },
    collection: (name: string) => collection(`${path}/${name}`),
  });
  const collection = (path: string): unknown => ({
    doc: (id?: string) => docRef(`${path}/${id ?? `auto${++auto}`}`),
    where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
    count: () => ({ get: async () => ({ data: () => ({ count: 4 }) }) }),
  });
  const db = {
    collection,
    batch: () => ({
      set: (ref: { id: string; path?: string }, data: Record<string, unknown>) => { writes.push({ path: String(ref.id), data }); },
      commit: async () => {},
    }),
  };
  return { db: db as unknown as FirebaseFirestore.Firestore, writes };
}

const base = {
  "colleges/c1/offerLetters/o1": { candidateId: "cand1", designation: "Professor", department: "CSE", status: "ACCEPTED" },
  "colleges/c1/candidates/cand1": { name: "Dr. Priya Nair", email: "priya@example.com", phone: "9999999999" },
  "colleges/c1/users/u9": { name: "Existing Login", email: "priya@vit.edu" },
};

describe("faculty provisioning writes the new name model", () => {
  it("provisionFacultyFromOffer: candidate name -> legalName; no `name`, no nameAsPerPan", async () => {
    const { db, writes } = fakeDb(base);
    const res = await provisionFacultyFromOffer(db, "c1", "o1", { collegeEmail: "priya@vit.edu", password: "password1" });
    expect(res.status).toBe("created");
    const faculty = writes.find((w) => "candidateId" in w.data)!.data;
    expect(faculty.legalName).toBe("Dr. Priya Nair");
    expect("name" in faculty).toBe(false);
    expect("nameAsPerPan" in faculty).toBe(false);
    // The login docs keep their own `name` field - a different entity.
    const login = writes.find((w) => w.data.role === "PANEL_MEMBER" && "isActive" in w.data)!.data;
    expect(login.name).toBe("Dr. Priya Nair");
  });

  it("linkFacultyToExistingAccount: candidate name -> legalName; no `name`, no nameAsPerPan", async () => {
    const { db, writes } = fakeDb(base);
    const res = await linkFacultyToExistingAccount(db, "c1", "o1", "u9");
    expect(res.status).toBe("linked");
    const faculty = writes.find((w) => "candidateId" in w.data)!.data;
    expect(faculty.legalName).toBe("Dr. Priya Nair");
    expect("name" in faculty).toBe(false);
    expect("nameAsPerPan" in faculty).toBe(false);
  });
});
