import { describe, expect, it } from "vitest";
import { admissionTypeOf, genderOf, matchBranch, matchSection, planFinalListSync, type SyncSection } from "./finalListSync";

// Shaped on Vishnu Institute of Technology's 1st year: each branch owns its sections ("CE-A", "AIML-B" ...) and the
// final list names branches by its own short forms (CIV, MECH, AI&ML ...).
const departments = [
  { name: "Civil Engineering", code: "CE" },
  { name: "Mechanical Engineering", code: "ME" },
  { name: "Computer Science and Engineering", code: "CSE" },
  { name: "Artificial Intelligence and Machine Learning", code: "AI&ML" },
  { name: "Computer Science and Business System", code: "CS&BS" },
  { name: "Basic Science", code: "BS" },
];
const sections: SyncSection[] = [
  { id: "ce-a", name: "CE-A", department: "Civil Engineering", courseId: "c1", courseName: "Bachelor of Technology" },
  { id: "me-a", name: "ME-A", department: "Mechanical Engineering", courseId: "c2" },
  { id: "cse-a", name: "CSE-A", department: "Computer Science and Engineering", courseId: "c3" },
  { id: "cse-b", name: "CSE-B", department: "Computer Science and Engineering", courseId: "c3" },
  { id: "aiml-a", name: "AIML-A", department: "Artificial Intelligence and Machine Learning", courseId: "c4" },
  { id: "aiml-b", name: "AIML-B", department: "Artificial Intelligence and Machine Learning", courseId: "c4" },
  { id: "csbs-a", name: "CSBS-A", department: "Computer Science and Business System", courseId: "c5" },
];

describe("final list sync", () => {
  it("matches the list's branch names to departments", () => {
    expect(matchBranch("CIV", departments, sections)).toBe("Civil Engineering");
    expect(matchBranch("MECH", departments, sections)).toBe("Mechanical Engineering");
    expect(matchBranch("CSE", departments, sections)).toBe("Computer Science and Engineering");
    expect(matchBranch("AI&ML", departments, sections)).toBe("Artificial Intelligence and Machine Learning");
    expect(matchBranch("CS&BS", departments, sections)).toBe("Computer Science and Business System");
    expect(matchBranch("XYZ", departments, sections)).toBeNull();
    // A department without sections this year (Basic Science) is never a match.
    expect(matchBranch("BS", departments, sections)).toBeNull();
  });

  it("finds the department's section for the list's letter", () => {
    expect(matchSection("Computer Science and Engineering", "B", sections)?.id).toBe("cse-b");
    expect(matchSection("Civil Engineering", "a", sections)?.id).toBe("ce-a");
    expect(matchSection("Civil Engineering", "B", sections)).toBeNull();
  });

  it("reads the list's type and gender", () => {
    expect(admissionTypeOf("CONV")).toBe("Convenor");
    expect(admissionTypeOf("CAT-B")).toBe("Management");
    expect(admissionTypeOf("SPOT")).toBe("Spot Admission");
    expect(genderOf("M")).toBe("Male");
    expect(genderOf("F")).toBe("Female");
  });

  it("sorts every student into new / moved / missing / changed / unchanged", () => {
    const plan = planFinalListSync({
      departments, sections,
      students: [
        { id: "s1", rollNumber: "26PA1A0501", name: "AKULA DIVYA SIRI", gender: "Female", admissionType: "Management", department: "Computer Science and Engineering", section: "CSE-A", courseId: "c3" },
        { id: "s2", rollNumber: "26PA1A0567", name: "GEDELA THIRUMSH", gender: "Male", admissionType: "Convenor", department: "Computer Science and Engineering", section: "CSE-A", courseId: "c3" },
        { id: "s3", rollNumber: "26PA1A0599", name: "LEFT STUDENT", department: "Computer Science and Engineering", section: "CSE-B", courseId: "c3" },
        { id: "s4", rollNumber: "26PA1A0101", name: "Allu Sri Rama Chandra Murthy", gender: "Male", admissionType: "", department: "Civil Engineering", section: "CE-A", courseId: "c1" },
        { id: "s5", rollNumber: "26PA1A4201", name: "OTHER BRANCH", department: "Mechanical Engineering", section: "ME-A", courseId: "c2" },
        { id: "s6", rollNumber: "26PA1A0598", name: "ALREADY LEFT", department: "Computer Science and Engineering", section: "", status: "DISCONTINUED", courseId: "c3" },
      ],
      rows: [
        { line: 2, branch: "CSE", roll: "26PA1A0501", name: "AKULA DIVYA SIRI", type: "CAT-B", gender: "F", section: "A" },
        { line: 3, branch: "CSE", roll: "26PA1A0567", name: "GEDELA THIRUMSH", type: "CONV", gender: "M", section: "B" },
        { line: 4, branch: "CIV", roll: "26PA1A0101", name: "ALLU SRI RAMA CHANDRA MURTHY", type: "CONV", gender: "M", section: "A" },
        { line: 5, branch: "CSE", roll: "26PA1A05Q2", name: "NEW JOINER", type: "SPOT", gender: "M", section: "B", hallTicket: "960363010506", rank: "5708" },
        { line: 6, branch: "AI&ML", roll: "26PA1A4201", name: "OTHER BRANCH", type: "CONV", gender: "M", section: "A" },
        { line: 7, branch: "CSE", roll: "26PA1A0501", name: "DUPLICATE", section: "A" },
        { line: 8, branch: "CSE", roll: "26PA1A0598", name: "ALREADY LEFT", section: "A" },
        { line: 9, branch: "CSE", roll: "26PA1A0700", name: "NO SUCH SECTION", section: "Z" },
        { line: 10, branch: "CSE", roll: "26PA1A0777", name: "OLDER YEAR", section: "A" },
      ],
      otherYearRolls: new Map([["26PA1A0777", "Year 2"]]),
    });
    expect(plan.unchanged).toBe(1); // s1
    expect(plan.moved).toEqual([{ studentId: "s2", roll: "26PA1A0567", name: "GEDELA THIRUMSH", department: "Computer Science and Engineering", from: "CSE-A", toSectionId: "cse-b", to: "CSE-B" }]);
    // Name differing only in case is NOT a change; the missing admission type is filled.
    expect(plan.changed).toEqual([{ studentId: "s4", roll: "26PA1A0101", name: "Allu Sri Rama Chandra Murthy", field: "admissionType", label: "Admission Type", from: "-", to: "Convenor" }]);
    expect(plan.added.map((a) => [a.roll, a.section, a.admissionType, a.hallTicket])).toEqual([["26PA1A05Q2", "CSE-B", "Spot Admission", "960363010506"]]);
    expect(plan.missing.map((m) => m.roll)).toEqual(["26PA1A0599"]); // not the discontinued one, not other branches
    const msgs = plan.problems.map((p) => `${p.roll}: ${p.message}`);
    expect(msgs.some((m) => m.startsWith("26PA1A4201") && /branch change/.test(m))).toBe(true);
    expect(msgs.some((m) => m.startsWith("26PA1A0501") && /twice/.test(m))).toBe(true);
    expect(msgs.some((m) => m.startsWith("26PA1A0598") && /Discontinued/.test(m))).toBe(true);
    expect(msgs.some((m) => m.startsWith("26PA1A0700") && /no section "Z"/.test(m))).toBe(true);
    expect(msgs.some((m) => m.startsWith("26PA1A0777") && /Year 2/.test(m))).toBe(true);
  });

  it("matches people by Hall Ticket / name, so a renumbered year becomes Regd. No changes - never a renamed record", () => {
    // VIT CS&BS 2026: GUNTI MOUNIKA left; everyone after her moved down one number.
    const D = "Computer Science and Business System";
    const app = [
      { id: "m", rollNumber: "26PA1A5719", name: "GUNTI MOUNIKA", department: D, section: "CSBS-A", courseId: "c5", hallTicketNo: "960365110157" },
      { id: "g", rollNumber: "26PA1A5720", name: "GUNTURI GAYATRI", department: D, section: "CSBS-A", courseId: "c5" },
      { id: "b", rollNumber: "26PA1A5721", name: "GUTTIKONDA BALESWAR", department: D, section: "CSBS-A", courseId: "c5" },
      { id: "k", rollNumber: "26PA1A5722", name: "KADIYALA SHAILENDRA", department: D, section: "CSBS-A", courseId: "c5", hallTicketNo: "960963010377" },
    ];
    const plan = planFinalListSync({
      departments, sections, students: app,
      rows: [
        { line: 2, branch: "CS&BS", roll: "26PA1A5719", name: "GUNTURI GAYATRI", type: "CAT-B", gender: "F", section: "A" },
        { line: 3, branch: "CS&BS", roll: "26PA1A5720", name: "GUTTIKONDA BALESWAR", type: "CAT-B", gender: "M", section: "A" },
        { line: 4, branch: "CS&BS", roll: "26PA1A5721", name: "KADIYALA SHAILENDRA", type: "CONV", gender: "M", section: "A", hallTicket: "960963010377" },
      ],
    });
    expect(plan.rollChanges.map((c) => `${c.name} ${c.from}->${c.to} (${c.matchedBy})`)).toEqual([
      "GUNTURI GAYATRI 26PA1A5720->26PA1A5719 (name)",
      "GUTTIKONDA BALESWAR 26PA1A5721->26PA1A5720 (name)",
      "KADIYALA SHAILENDRA 26PA1A5722->26PA1A5721 (hallTicket)",
    ]);
    // Nobody is renamed onto someone else's record, nobody is "new".
    expect(plan.changed.filter((c) => c.field === "name")).toEqual([]);
    expect(plan.added).toEqual([]);
    // GUNTI MOUNIKA left - and her number is given to GUNTURI GAYATRI.
    expect(plan.missing).toEqual([{ studentId: "m", roll: "26PA1A5719", name: "GUNTI MOUNIKA", department: D, section: "CSBS-A", numberReused: true }]);
  });

  it("a close spelling is matched (and corrected); a loose one is only flagged", () => {
    const D = "Civil Engineering";
    const app = [
      { id: "a", rollNumber: "26PA1A0128", name: "KESARI TEJO DEEP", department: D, section: "CE-A", courseId: "c1" },
      { id: "b", rollNumber: "26PA1A0130", name: "L CHANDRA SEKHAR", department: D, section: "CE-A", courseId: "c1" },
    ];
    const plan = planFinalListSync({
      departments, sections, students: app,
      rows: [
        { line: 2, branch: "CIV", roll: "26PA1A0128", name: "KESARI TEJOO DEEP", section: "A" },
        { line: 3, branch: "CIV", roll: "26PA1A0130", name: "LAKSHMIPATHULA CHANDRA SHEKAR", section: "A" },
      ],
    });
    expect(plan.changed).toEqual([{ studentId: "a", roll: "26PA1A0128", name: "KESARI TEJO DEEP", field: "name", label: "Name", from: "KESARI TEJO DEEP", to: "KESARI TEJOO DEEP" }]);
    // Not matched, not added, not marked as left: shown to be checked.
    expect(plan.added).toEqual([]);
    expect(plan.missing).toEqual([]);
    expect(plan.problems.some((p) => /may be L CHANDRA SEKHAR/.test(p.message))).toBe(true);
  });

  it("an unmatched branch can be chosen by hand", () => {
    const rows = [{ line: 2, branch: "CIVIL-ENGG", roll: "26PA1A0102", name: "X", section: "A" }];
    expect(planFinalListSync({ departments, sections, students: [], rows }).problems[0].message).toMatch(/isn't matched/);
    expect(planFinalListSync({ departments, sections, students: [], rows, branchMap: { "CIVIL-ENGG": "Civil Engineering" } }).added).toHaveLength(1);
  });
});
