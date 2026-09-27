import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { exportSupportingStaffCsv } from "./exportCsv";
import type { SupportingStaffMember } from "@/types";

// This suite runs in vitest's "node" environment (see vitest.config.mts) - no
// jsdom/happy-dom dependency in this project, so downloadCSV's few browser
// calls (document.createElement("a"), URL.createObjectURL/revokeObjectURL)
// are stubbed directly on globalThis rather than pulling in a DOM library
// just for this one file. Only what downloadCSV (src/lib/utils/csv.ts)
// actually touches is stubbed; Blob itself is a real Node global.
function makeTimestamp(iso: string) {
  return { toDate: () => new Date(iso) };
}

function baseStaff(overrides: Partial<SupportingStaffMember> = {}): SupportingStaffMember {
  return {
    id: "s1",
    collegeId: "college1",
    employeeId: "STF001",
    legalName: "RAVI TEJA",
    staffCategory: "NON_TECHNICAL",
    designation: "OFFICE_STAFF",
    highestQualification: "B.Com",
    totalYearsOfExperience: 5,
    joiningDate: makeTimestamp("2018-06-11") as never,
    status: "ACTIVE",
    collegeEmail: "ravi.teja@college.edu",
    mobileNo: "9876543210",
    gender: "Male",
    dateOfBirth: makeTimestamp("1988-04-17") as never,
    aadharNo: "123456789012",
    panNo: "ABCDE1234F",
    ...overrides,
  } as SupportingStaffMember;
}

describe("exportSupportingStaffCsv", () => {
  let created: { href: string; download: string; clicked: boolean }[];
  let lastBlob: Blob | null;

  beforeEach(() => {
    created = [];
    lastBlob = null;
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        if (tag !== "a") throw new Error(`unexpected element: ${tag}`);
        const el = { href: "", download: "", clicked: false, click() { this.clicked = true; } };
        created.push(el);
        return el;
      },
    });
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => { lastBlob = blob; return "blob:mock-url"; },
      revokeObjectURL: () => {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function runExport(staff: SupportingStaffMember[], prefix = "test_staff") {
    exportSupportingStaffCsv(staff, prefix);
    expect(created).toHaveLength(1);
    expect(created[0].clicked).toBe(true);
    expect(created[0].download).toMatch(new RegExp(`^${prefix}_export_\\d{4}-\\d{2}-\\d{2}\\.csv$`));
    expect(lastBlob).not.toBeNull();
    return (await lastBlob!.text()).split("\r\n");
  }

  it("downloads a file named after the given prefix and today's date", async () => {
    await runExport([baseStaff()]);
  });

  it("writes the full header row in the documented column order", async () => {
    const [header] = await runExport([baseStaff()]);
    expect(header).toBe(
      [
        "Employee ID", "Full Name (as per SSC)", "Name (as per PAN)", "Name (as per Aadhar)",
        "Staff Category", "Designation", "Department", "Status", "College Email", "Personal Email",
        "Mobile No", "Highest Qualification", "Date of Joining Institution", "Total Years of Experience",
        "Gender", "Date of Birth", "Aadhar No", "PAN No",
      ].join(",")
    );
  });

  it("resolves designation to its display label and formats dates as YYYY-MM-DD", async () => {
    const [, row] = await runExport([baseStaff()]);
    const cells = row.split(",");
    expect(cells[0]).toBe("STF001"); // Employee ID
    expect(cells[1]).toBe("RAVI TEJA"); // legalName
    expect(cells[4]).toBe("Non-Technical Staff"); // Staff Category label
    expect(cells[5]).toBe("Office Staff"); // designation label, not the raw code
    expect(cells[12]).toBe("2018-06-11"); // joiningDate
    expect(cells[15]).toBe("1988-04-17"); // dateOfBirth
  });

  it('falls back an empty department to "Centrally managed"', async () => {
    const [, row] = await runExport([baseStaff({ department: undefined })]);
    expect(row.split(",")[6]).toBe("Centrally managed");
  });

  it("keeps a real department value untouched", async () => {
    const [, row] = await runExport([baseStaff({ department: "Computer Science" })]);
    expect(row.split(",")[6]).toBe("Computer Science");
  });

  it('uses otherDesignationTitle when designation is "OTHER"', async () => {
    const [, row] = await runExport([
      baseStaff({ designation: "OTHER" as SupportingStaffMember["designation"], otherDesignationTitle: "Security Supervisor" }),
    ]);
    expect(row.split(",")[5]).toBe("Security Supervisor");
  });

  it("quotes a field containing a comma so it survives round-tripping through Excel/Sheets", async () => {
    const [, row] = await runExport([baseStaff({ highestQualification: "B.Com, MBA" })]);
    expect(row).toContain('"B.Com, MBA"');
  });

  it("exports one row per staff member, in the order given", async () => {
    const rows = await runExport([
      baseStaff({ id: "s1", employeeId: "STF001" }),
      baseStaff({ id: "s2", employeeId: "STF002", legalName: "LAKSHMI PRASANNA" }),
    ]);
    expect(rows).toHaveLength(3); // header + 2 rows
    expect(rows[1].split(",")[0]).toBe("STF001");
    expect(rows[2].split(",")[0]).toBe("STF002");
  });

  it("never includes a password/login-credential column", async () => {
    const [header] = await runExport([baseStaff()]);
    expect(header.toLowerCase()).not.toContain("password");
  });
});
