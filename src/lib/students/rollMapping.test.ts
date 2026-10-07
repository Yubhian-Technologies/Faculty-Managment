import { describe, expect, it } from "vitest";
import { classifyRollMapping, summarizeRollMapping, type ClassifyInput, type RollHolderLookup, type StudentForMapping } from "./rollMapping";

const student = (over: Partial<StudentForMapping> & { id: string }): StudentForMapping => ({ ...over });

const classify = (over: Partial<ClassifyInput>) =>
  classifyRollMapping({
    rows: [],
    students: [],
    rollHolderByKey: new Map<string, RollHolderLookup>(),
    replaceExisting: false,
    ...over,
  });

const ANA = student({ id: "s1", name: "Ana Rao", mobileNo: "9876501001" });
const BOB = student({ id: "s2", name: "Bob Rao", mobileNo: "9876501002", rollNumber: "22A1" });

describe("classifyRollMapping", () => {
  it("sets a roll on a student who has none", () => {
    const [r] = classify({ rows: [{ rowNumber: 2, mobile: "9876501001", roll: "22B5" }], students: [ANA] });
    expect(r.outcome).toBe("WILL_SET");
    expect(r.studentId).toBe("s1");
  });

  // Re-running a file must be a no-op, which is what makes a partial run safe
  // to repeat.
  it("skips a student who already holds exactly that roll", () => {
    const [r] = classify({ rows: [{ rowNumber: 2, mobile: "9876501002", roll: "22A1" }], students: [BOB] });
    expect(r.outcome).toBe("ALREADY_SET");
  });

  it("treats the same roll written differently as already set", () => {
    const [r] = classify({ rows: [{ rowNumber: 2, mobile: "9876501002", roll: " 22-a1 " }], students: [BOB] });
    expect(r.outcome).toBe("ALREADY_SET");
  });

  it("skips a student who holds a different roll, unless replacing", () => {
    const rows = [{ rowNumber: 2, mobile: "9876501002", roll: "22Z9" }];
    expect(classify({ rows, students: [BOB] })[0].outcome).toBe("DIFFERENT_ROLL");
    expect(classify({ rows, students: [BOB], replaceExisting: true })[0].outcome).toBe("WILL_SET");
  });

  it("reports a mobile that matches nobody", () => {
    const [r] = classify({ rows: [{ rowNumber: 2, mobile: "9999999999", roll: "22B5" }], students: [ANA] });
    expect(r.outcome).toBe("NO_MATCH");
  });

  // One live college really does have two students on one mobile - this must
  // refuse rather than pick one.
  it("refuses a mobile shared by two students", () => {
    const twin = student({ id: "s3", name: "Twin", mobileNo: "9876501001" });
    const [r] = classify({ rows: [{ rowNumber: 2, mobile: "9876501001", roll: "22B5" }], students: [ANA, twin] });
    expect(r.outcome).toBe("MOBILE_SHARED");
    expect(r.studentId).toBeUndefined();
  });

  it("refuses a roll held by another student in this college, and names them", () => {
    const holders = new Map<string, RollHolderLookup>([["22b5", { name: "Someone Else", sameCollege: true, studentDocId: "sX" }]]);
    const [r] = classify({ rows: [{ rowNumber: 2, mobile: "9876501001", roll: "22B5" }], students: [ANA], rollHolderByKey: holders });
    expect(r.outcome).toBe("ROLL_TAKEN");
    expect(r.message).toContain("Someone Else");
  });

  // Roll uniqueness is global, so a holder in another college blocks too - but
  // without naming them.
  it("refuses a roll held in another college without naming the holder", () => {
    const holders = new Map<string, RollHolderLookup>([["22b5", { name: "Private", sameCollege: false, studentDocId: "sX" }]]);
    const [r] = classify({ rows: [{ rowNumber: 2, mobile: "9876501001", roll: "22B5" }], students: [ANA], rollHolderByKey: holders });
    expect(r.outcome).toBe("ROLL_TAKEN");
    expect(r.message).toContain("another college");
    expect(r.message).not.toContain("Private");
  });

  // The registry naturally lists the student we are setting as the holder once
  // they hold it; that is not a conflict.
  it("does not treat the student's own registry entry as a conflict", () => {
    const holders = new Map<string, RollHolderLookup>([["22a1", { name: "Bob Rao", sameCollege: true, studentDocId: "s2" }]]);
    const [r] = classify({ rows: [{ rowNumber: 2, mobile: "9876501002", roll: "22A1" }], students: [BOB], rollHolderByKey: holders });
    expect(r.outcome).toBe("ALREADY_SET");
  });

  it("refuses BOTH rows when one roll appears twice in the file", () => {
    const out = classify({
      rows: [
        { rowNumber: 2, mobile: "9876501001", roll: "22B5" },
        { rowNumber: 3, mobile: "9876501002", roll: "22b5" },
      ],
      students: [ANA, BOB],
    });
    expect(out.map((r) => r.outcome)).toEqual(["DUPLICATE_IN_FILE", "DUPLICATE_IN_FILE"]);
  });

  it("does not read two blank roll cells as a duplicate", () => {
    const out = classify({
      rows: [
        { rowNumber: 2, mobile: "9876501001", roll: "" },
        { rowNumber: 3, mobile: "9876501002", roll: "   " },
      ],
      students: [ANA, BOB],
    });
    expect(out.map((r) => r.outcome)).toEqual(["BAD_ROLL", "BAD_ROLL"]);
  });

  it("rejects an unusable roll or mobile cell", () => {
    expect(classify({ rows: [{ rowNumber: 2, mobile: "9876501001", roll: "---" }], students: [ANA] })[0].outcome).toBe("BAD_ROLL");
    expect(classify({ rows: [{ rowNumber: 2, mobile: "12345", roll: "22B5" }], students: [ANA] })[0].outcome).toBe("BAD_MOBILE");
  });

  it("matches a mobile written with spaces or a country code", () => {
    const [r] = classify({ rows: [{ rowNumber: 2, mobile: "+91 98765 01001", roll: "22B5" }], students: [ANA] });
    expect(r.outcome).toBe("WILL_SET");
    expect(r.mobileNormalized).toBe("9876501001");
  });

  // A conflicting roll is more useful to report than "has a different roll",
  // since the roll is unavailable either way.
  it("reports ROLL_TAKEN ahead of DIFFERENT_ROLL when both apply", () => {
    const holders = new Map<string, RollHolderLookup>([["22z9", { sameCollege: true, studentDocId: "sX" }]]);
    const [r] = classify({ rows: [{ rowNumber: 2, mobile: "9876501002", roll: "22Z9" }], students: [BOB], rollHolderByKey: holders });
    expect(r.outcome).toBe("ROLL_TAKEN");
  });

  it("still refuses a taken roll when replacing is ticked", () => {
    const holders = new Map<string, RollHolderLookup>([["22z9", { sameCollege: true, studentDocId: "sX" }]]);
    const [r] = classify({ rows: [{ rowNumber: 2, mobile: "9876501002", roll: "22Z9" }], students: [BOB], rollHolderByKey: holders, replaceExisting: true });
    expect(r.outcome).toBe("ROLL_TAKEN");
  });
});

describe("name column", () => {
  it("warns on a mismatch but still applies the row", () => {
    const [r] = classify({ rows: [{ rowNumber: 2, mobile: "9876501001", roll: "22B5", name: "Someone Different" }], students: [ANA] });
    expect(r.outcome).toBe("WILL_SET");
    expect(r.nameMismatch).toBe(true);
  });

  it("does not warn on spacing or case differences", () => {
    const [r] = classify({ rows: [{ rowNumber: 2, mobile: "9876501001", roll: "22B5", name: "  ana   RAO " }], students: [ANA] });
    expect(r.nameMismatch).toBe(false);
  });

  it("does not warn when the file leaves the name blank", () => {
    const [r] = classify({ rows: [{ rowNumber: 2, mobile: "9876501001", roll: "22B5" }], students: [ANA] });
    expect(r.nameMismatch).toBe(false);
  });
});

describe("summarizeRollMapping", () => {
  it("counts every outcome, including the ones with none", () => {
    const results = classify({
      rows: [
        { rowNumber: 2, mobile: "9876501001", roll: "22B5" },
        { rowNumber: 3, mobile: "9876501002", roll: "22A1" },
        { rowNumber: 4, mobile: "9999999999", roll: "22C7" },
      ],
      students: [ANA, BOB],
    });
    const counts = summarizeRollMapping(results);
    expect(counts.WILL_SET).toBe(1);
    expect(counts.ALREADY_SET).toBe(1);
    expect(counts.NO_MATCH).toBe(1);
    expect(counts.MOBILE_SHARED).toBe(0);
  });
});
