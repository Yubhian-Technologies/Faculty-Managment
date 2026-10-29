import { describe, expect, it } from "vitest";
import { EXPORT_FIELDS, EXPORT_MODULE_LABELS, EXPORT_MODULE_ORDER } from "./csvColumns";
import { PROFILE_MODULES, SELF_EDIT_DISABLED_MODULES, getFacultyProfileModules, isSelfEditDisabled, type ProfileModuleKey } from "./profileModules";

// Renaming a faculty details tab is a DISPLAY change. These tests pin both halves of that promise:
// the new names and descriptions are exactly what was asked for, and nothing a URL, an export or a stored
// record depends on (the tab keys, the field keys, who may edit what) moved.

const KEYS: ProfileModuleKey[] = ["personal", "qualification", "experience", "research", "mentorship", "financial", "others", "teaching-load"];

describe("faculty details tab names", () => {
  it("shows exactly the requested names", () => {
    expect(Object.fromEntries(KEYS.map((k) => [k, PROFILE_MODULES[k].label]))).toEqual({
      personal: "Personal & Contact Information",
      qualification: "Academic Qualification", // kept as it was
      experience: "Professional Experience & Employment",
      research: "Research, Innovation & Publications",
      mentorship: "Professional Development & Certifications",
      financial: "Compensation & Benefits",
      others: "Additional Information & Institutional Contributions",
      "teaching-load": "Teaching & Academic Responsibilities",
    });
  });

  it("shows exactly the requested line under each heading", () => {
    expect(PROFILE_MODULES.personal.description).toBe("Personal information, contact details, address, emergency contact and all personal details.");
    expect(PROFILE_MODULES.qualification.description).toBe("Degrees, specializations, institutions, year of passing, certifications, and additional qualifications.");
    expect(PROFILE_MODULES.experience.description).toBe("Previous employment, teaching and academic, industry and research experience, service history, and years of experience.");
    expect(PROFILE_MODULES.research.description).toBe("Research projects, publications, patents, consultancy, funded projects, copyrights, and innovation activities.");
    expect(PROFILE_MODULES.mentorship.description).toBe("FDPs, workshops, conferences, training programmes, certifications, and professional memberships.");
    expect(PROFILE_MODULES.financial.description).toBe("Salary structure, increments, promotions, financial rewards, incentives, gratuity, and other employment benefits. Access is restricted to authorized personnel.");
    expect(PROFILE_MODULES["teaching-load"].description).toBe("Courses handled, subjects, timetable, teaching hours, workload allocation, mentoring responsibilities, and academic duties.");
    expect(PROFILE_MODULES.others.description).toBeUndefined(); // no line was specified for this tab
  });

  it("every tab keeps its key, icon and a distinct name", () => {
    expect(Object.keys(PROFILE_MODULES)).toEqual([...KEYS, "display-name"]);
    for (const k of KEYS) {
      expect(PROFILE_MODULES[k].key).toBe(k);
      expect(PROFILE_MODULES[k].icon).toBeTruthy();
    }
    expect(new Set(KEYS.map((k) => PROFILE_MODULES[k].label)).size).toBe(KEYS.length);
  });
});

describe("nothing a URL, an export or a record depends on changed", () => {
  it("the tabs are listed in the same order, with the same ones hidden or excluded", () => {
    expect(getFacultyProfileModules().map((m) => m.key)).toEqual(["personal", "qualification", "experience", "research", "mentorship", "financial", "teaching-load", "others"]);
    expect(getFacultyProfileModules({ hideFinancialModule: true }).map((m) => m.key)).not.toContain("financial");
    expect(getFacultyProfileModules({ excludeModules: ["research", "teaching-load"] }).map((m) => m.key)).toEqual(["personal", "qualification", "experience", "mentorship", "financial", "others"]);
  });

  it("who may edit what is untouched", () => {
    expect(SELF_EDIT_DISABLED_MODULES).toEqual(["financial", "teaching-load", "research"]);
    expect(isSelfEditDisabled("financial", true)).toBe(true);
    expect(isSelfEditDisabled("teaching-load", false)).toBe(true);
    expect(isSelfEditDisabled("teaching-load", true)).toBe(false);
    expect(isSelfEditDisabled("personal", true)).toBe(false);
  });

  it("exports and completion keep their keys and order; only the section names follow the new tab names", () => {
    expect(EXPORT_MODULE_ORDER).toEqual(["core", "personal", "qualification", "experience", "research", "mentorship", "financial", "others", "teaching-load"]);
    expect(EXPORT_MODULE_LABELS.core).toBe("Identity & Employment");
    for (const k of KEYS) expect(EXPORT_MODULE_LABELS[k]).toBe(PROFILE_MODULES[k].label);
  });

  it("export column wording and field keys are untouched (a tab name is not a column name)", () => {
    const byKey = new Map(EXPORT_FIELDS.map((f) => [f.key, f]));
    expect(byKey.get("employeeId")?.label).toBe("Employee ID");
    expect(byKey.get("fatherName")?.label).toBe("Father Name");
    expect(byKey.get("monthlySalary")?.label).toBe("Monthly Salary (₹)");
    expect(byKey.get("ugDetailsGroup")?.label).toBe("UG Details");
    expect(EXPORT_FIELDS.some((f) => Object.values(PROFILE_MODULES).some((m) => m.label === f.label))).toBe(false);
    // every export field still belongs to a known section
    for (const f of EXPORT_FIELDS) expect(EXPORT_MODULE_ORDER).toContain(f.module);
  });
});
