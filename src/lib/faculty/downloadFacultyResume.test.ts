import { beforeEach, describe, expect, it, vi } from "vitest";

const downloadResumePdf = vi.fn(async () => {});
vi.mock("@/lib/pdf/downloadResume", () => ({ downloadResumePdf: (...a: unknown[]) => downloadResumePdf(...(a as [])) }));

import { downloadFacultyResume } from "./downloadFacultyResume";

type Handler = (url: string) => Promise<unknown> | unknown;
function mockFetch(handler: Handler) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    const body = await handler(url);
    return { json: async () => body };
  });
  return calls;
}

const row = { id: "f1", employeeId: "EMP7", legalName: "Asha Rao", userUid: "u9", department: "CSE" };
const sections = ["profile", "teaching"] as never;

beforeEach(() => {
  downloadResumePdf.mockClear();
  vi.unstubAllGlobals();
});

describe("downloadFacultyResume", () => {
  it("enriches the row with teaching load and publications, then renders with the chosen sections", async () => {
    const calls = mockFetch((url) =>
      url.includes("teaching-assignments") ? { assignments: [{ id: "a1" }] } : { publications: [{ id: "p1" }] }
    );
    await downloadFacultyResume(row, "Vishnu Institute", sections);

    expect(calls).toEqual([
      "/api/college/teaching-assignments?facultyId=f1",
      "/api/college/publications?uid=u9",
    ]);
    expect(downloadResumePdf).toHaveBeenCalledTimes(1);
    const [record, hint] = downloadResumePdf.mock.calls[0] as unknown as [Record<string, unknown>, string];
    expect(record).toMatchObject({
      id: "f1",
      collegeName: "Vishnu Institute",
      sections,
      teachingAssignments: [{ id: "a1" }],
      researchPublications: [{ id: "p1" }],
    });
    expect(hint).toBe("EMP7");
  });

  it("falls back to the legalName for the filename when there is no employee id", async () => {
    mockFetch(() => ({}));
    await downloadFacultyResume({ ...row, employeeId: "" }, "", sections);
    expect((downloadResumePdf.mock.calls[0] as unknown as [unknown, string])[1]).toBe("Asha Rao");
  });

  it("uses the faculty id with URL encoding, and skips publications when there is no login uid", async () => {
    const calls = mockFetch(() => ({ assignments: [] }));
    await downloadFacultyResume({ id: "a b/c", employeeId: "E1" }, "", sections);
    expect(calls).toEqual(["/api/college/teaching-assignments?facultyId=a%20b%2Fc"]);
  });

  it("still produces the resume when both lookups fail", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("network down"); });
    await downloadFacultyResume(row, "X", sections);
    const record = (downloadResumePdf.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(record.teachingAssignments).toEqual([]);
    expect(record.researchPublications).toEqual([]);
  });

  it("surfaces a failure of the PDF step itself", async () => {
    mockFetch(() => ({}));
    downloadResumePdf.mockRejectedValueOnce(new Error("Your session needs a refresh - reload the page and try again."));
    await expect(downloadFacultyResume(row, "", sections)).rejects.toThrow(/session needs a refresh/);
  });
});
