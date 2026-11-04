import { describe, expect, it } from "vitest";
import { starterCatalog } from "./catalog";
import { buildCertificateValues, displayDate } from "./documentValues";
import { fillPlaceholders, missingPlaceholders, PLACEHOLDER_GROUPS, renderCertificateHtml } from "./render";
import { cleanFlow, cleanPurpose, namesUser, cleanTemplate, cleanTypeConfig, cleanValues, eligibilityProblem, formatCertificateNumber } from "./typeConfig";
import type { CertificateTemplate } from "@/types";

const KNOWN = new Set(PLACEHOLDER_GROUPS.flatMap((g) => g.items.map((i) => i.key)));

describe("starter catalogue", () => {
  const items = starterCatalog();

  it("has the 28 certificates, each with a unique code and its own template", () => {
    expect(items).toHaveLength(28);
    expect(new Set(items.map((i) => i.type.code)).size).toBe(28);
    expect(new Set(items.map((i) => i.templateId)).size).toBe(28);
  });

  it("every type and template passes the same checks as an admin save", () => {
    const ids = new Set(items.map((i) => i.templateId));
    for (const i of items) {
      const t = cleanTypeConfig(i.type, ids);
      expect(t.ok, `${i.type.name}: ${t.ok ? "" : t.error}`).toBe(true);
      const tpl = cleanTemplate(i.template);
      expect(tpl.ok, `${i.template.name}: ${tpl.ok ? "" : tpl.error}`).toBe(true);
    }
  });

  it("templates use only placeholders something fills (record, request, form or issuer fields)", () => {
    for (const i of items) {
      const own = new Set([...i.type.fields, ...i.type.issuerFields].map((f) => f.key));
      const texts = [i.template.body ?? "", i.template.footer ?? "", ...(i.template.rows ?? []).map((r) => r.value)];
      for (const t of texts) {
        for (const m of t.matchAll(/\{\{\s*([a-zA-Z0-9]+)\s*\}\}/g)) {
          expect(KNOWN.has(m[1]) || own.has(m[1]), `${i.type.name} uses {{${m[1]}}}`).toBe(true);
        }
      }
    }
  });

  it("only No Dues is switched on when installed", () => {
    expect(items.filter((i) => i.type.isActive).map((i) => i.type.catalogKey)).toEqual(["NO_DUES"]);
  });
});

describe("type configuration", () => {
  it("refuses a parallel step with one approver and an empty flow", () => {
    expect(cleanFlow([]).ok).toBe(false);
    const one = cleanFlow([{ type: "PARALLEL", label: "Clearances", branches: [{ recipient: { kind: "ROLE", role: "LIBRARY" } }] }]);
    expect(one.ok).toBe(false);
  });

  it("refuses an approver role that cannot approve, and a named person without a uid", () => {
    expect(cleanFlow([{ type: "SEQUENTIAL", label: "x", recipient: { kind: "ROLE", role: "STUDENT" } }]).ok).toBe(false);
    expect(cleanFlow([{ type: "SEQUENTIAL", label: "x", recipient: { kind: "USER", name: "A" } }]).ok).toBe(false);
  });

  it("needs {SEQ} in the number format and a known template", () => {
    const base = starterCatalog()[0];
    expect(cleanTypeConfig({ ...base.type, numberFormat: "BON/{YYYY}" }, new Set([base.templateId])).ok).toBe(false);
    expect(cleanTypeConfig(base.type, new Set()).ok).toBe(false);
  });

  it("formats certificate numbers", () => {
    expect(formatCertificateNumber("VIT/{CODE}/{YYYY}/{SEQ}", { code: "BON", year: 2026, academicYear: "2026-27", seq: 7 })).toBe("VIT/BON/2026/0007");
    expect(formatCertificateNumber("{CODE}-{AY}-{SEQ}", { code: "TC", year: 2026, academicYear: "2026-27", seq: 12345 })).toBe("TC-2026-27-12345");
  });
});

describe("named approvers", () => {
  it("finds a person named in a step, a parallel approval or as issuer - not a role", () => {
    const role = { kind: "ROLE" as const, role: "PRINCIPAL" as const };
    const me = { kind: "USER" as const, uid: "u1", name: "A" };
    expect(namesUser({ issuer: role, flow: [{ id: "a", type: "SEQUENTIAL", label: "x", recipient: role }] }, "u1")).toBe(false);
    expect(namesUser({ issuer: me, flow: [] }, "u1")).toBe(true);
    expect(namesUser({ issuer: role, flow: [{ id: "a", type: "PARALLEL", label: "x", branches: [{ key: "k", label: "", recipient: me }, { key: "j", label: "", recipient: role }] }] }, "u1")).toBe(true);
  });
});

describe("student answers", () => {
  const fields = [
    { key: "semester", label: "Semester", kind: "number" as const, required: true },
    { key: "reason", label: "Reason", kind: "select" as const, options: ["Lost", "Damaged"], required: true },
    { key: "note", label: "Note", kind: "text" as const, required: false },
    { key: "conduct", label: "Conduct", kind: "text" as const, required: true, defaultValue: "Good" },
  ];

  it("checks required, numbers and options, and drops unknown keys", () => {
    expect(cleanValues(fields, { semester: "3", reason: "Lost", conduct: "x", other: "y" })).toEqual({ ok: true, value: { semester: "3", reason: "Lost", conduct: "x" } });
    expect(cleanValues(fields, { semester: "three", reason: "Lost", conduct: "x" }).ok).toBe(false);
    expect(cleanValues(fields, { semester: "3", reason: "Stolen", conduct: "x" }).ok).toBe(false);
    expect(cleanValues(fields, { semester: "3", reason: "Lost" }).ok).toBe(false);
  });

  it("issuer fields fall back to their default", () => {
    expect(cleanValues(fields, { semester: "3", reason: "Lost" }, true)).toEqual({ ok: true, value: { semester: "3", reason: "Lost", conduct: "Good" } });
  });

  it("purpose: from the list, or the student's own text when Other is allowed", () => {
    const t = { purposes: ["Passport", "Visa"], allowOtherPurpose: true };
    expect(cleanPurpose(t, "Visa", "")).toEqual({ ok: true, value: "Visa" });
    expect(cleanPurpose(t, "Other", "Driving licence")).toEqual({ ok: true, value: "Driving licence" });
    expect(cleanPurpose(t, "Other", "").ok).toBe(false);
    expect(cleanPurpose({ purposes: ["Passport"], allowOtherPurpose: false }, "Other", "x").ok).toBe(false);
    expect(cleanPurpose({ purposes: [], allowOtherPurpose: false }, undefined, undefined)).toEqual({ ok: true, value: null });
  });

  it("eligibility by status and year", () => {
    const t = { isActive: true, eligibility: { statuses: ["GRADUATED" as const], years: [] } };
    expect(eligibilityProblem(t, { status: "REGULAR", year: 3 })).toMatch(/after you complete/);
    expect(eligibilityProblem(t, { status: "GRADUATED", year: 4 })).toBeNull();
    expect(eligibilityProblem({ isActive: true, eligibility: { statuses: [], years: [4] } }, { year: 3 })).toMatch(/year 4/);
    expect(eligibilityProblem({ ...t, isActive: false }, { status: "GRADUATED" })).toMatch(/isn't available/);
  });
});

describe("certificate text", () => {
  const values = buildCertificateValues({
    student: { name: "Ravi Kumar", rollNumber: "22A31A0501", gender: "Male", fatherName: "Suresh", year: 3, course: "B.Tech", department: "CSE", dateOfBirth: "2004-05-09", status: "REGULAR" },
    request: { purpose: "Passport", values: { semester: "5" }, createdAt: new Date("2026-11-01T06:00:00Z") },
    issuerValues: { conduct: "Good" }, academicYear: "2026-27", issueDate: new Date("2026-11-03T06:00:00Z"),
  });

  it("fills record values, pronouns, roman year and day-first dates", () => {
    expect(values).toMatchObject({ studentName: "Ravi Kumar", heShe: "he", sonDaughter: "son", MrMs: "Mr.", year: "III", dateOfBirth: "09-05-2004", issueDate: "03-11-2026", studentStatus: "is studying", semester: "5", conduct: "Good" });
    expect(displayDate("2026-01-31")).toBe("31-01-2026");
  });

  it("a form answer never replaces a record value", () => {
    const v = buildCertificateValues({ student: { name: "Ravi" }, request: { values: { studentName: "Someone else" } } as never, academicYear: "2026-27", issueDate: new Date() });
    expect(v.studentName).toBe("Ravi");
  });

  it("escapes what students type and marks missing values in the preview", () => {
    expect(fillPlaceholders("Name {{studentName}}", { studentName: "<b>x</b>" })).toBe("Name <b>&lt;b&gt;x&lt;/b&gt;</b>");
    expect(fillPlaceholders("{{fatherName}}", {}, true)).toContain('class="missing"');
    expect(fillPlaceholders("{{fatherName}}", {})).toBe("__________");
    expect(missingPlaceholders(["{{studentName}} {{fatherName}}"], { studentName: "A" })).toEqual(["fatherName"]);
  });

  it("renders a letter with the number, signature and QR", () => {
    const tpl: CertificateTemplate = { id: "t", name: "Bonafide", kind: "LETTER", title: "BONAFIDE CERTIFICATE", body: "This is to certify that {{studentName}} ...", showQr: true };
    const html = renderCertificateHtml(tpl, {
      college: { name: "Test College" }, values, certificateNumber: "BON/2026/0001", verifyUrl: "https://example.org/verify-certificate/ABC123XYZ0",
      signature: { id: "s", name: "Dr. A", designation: "Principal", imageUrl: "" },
    });
    expect(html).toContain("BON/2026/0001");
    expect(html).toContain("<svg");
    expect(html).toContain("Ravi Kumar");
    expect(html).toContain("Principal");
  });
});
