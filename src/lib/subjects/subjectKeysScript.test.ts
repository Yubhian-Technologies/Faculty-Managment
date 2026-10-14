import { describe, expect, it } from "vitest";
import { codeKeyId, nameKeyId, planSubjectKeys } from "../../../scripts/lib/subjectKeysCore.mjs";
import { keyDocId } from "./subjectKeys";

// The maintenance scripts write lock docs by hand; their ids must be the ones the app computes.
describe("subject key script parity", () => {
  it("builds the same lock ids as the app", () => {
    expect(codeKeyId("cat1", "R20", " cs201 ")).toBe(keyDocId({ field: "code", scope: "cat1", regulation: "R20", value: "CS201" }));
    expect(nameKeyId("cat1", "R20", "Data   Structures")).toBe(keyDocId({ field: "name", scope: "cat1", regulation: "R20", value: "data structures" }));
  });
});

const sub = (id: string, over: Record<string, unknown>) => ({ id, data: { courseId: "c1", regulation: "R20", code: "A1", name: `Name ${id}`, ...over } });
const courses = [{ id: "c1", data: { catalogId: "cat1" } }, { id: "c2", data: { catalogId: "cat1" } }];

describe("planSubjectKeys", () => {
  it("keys clean subjects and stamps catalogId / nameKey / normalised code", () => {
    const p = planSubjectKeys([sub("s1", { code: "cs201 " })], courses);
    expect(p.clashes).toEqual([]);
    expect(p.keys.map((k) => k.field).sort()).toEqual(["code", "name"]);
    expect(p.subjectFixes[0].set).toMatchObject({ catalogId: "cat1", nameKey: "name s1", code: "CS201" });
  });

  it("finds a code clash across sibling departments' Course docs and leaves the members alone", () => {
    const p = planSubjectKeys([sub("s1", { courseId: "c1" }), sub("s2", { courseId: "c2", code: "a1" }), sub("s3", { code: "B2" })], courses);
    expect(p.clashes).toHaveLength(1);
    expect(p.clashes[0]).toMatchObject({ field: "code", value: "A1" });
    expect(p.clashes[0].members.map((m) => m.id).sort()).toEqual(["s1", "s2"]);
    expect(p.keys.every((k) => k.subjectId === "s3")).toBe(true);
  });

  it("finds a name clash regardless of case and spacing, but not across regulations", () => {
    const p = planSubjectKeys([sub("s1", { name: "Data  Structures", code: "A" }), sub("s2", { name: "data structures", code: "B" }), sub("s3", { name: "Data Structures", code: "C", regulation: "R23" })], courses);
    expect(p.clashes.map((c) => c.field)).toEqual(["name"]);
    expect(p.clashes[0].members.map((m) => m.id).sort()).toEqual(["s1", "s2"]);
  });

  it("reports subjects it can't key and skips legacy semester-scoped ones", () => {
    const p = planSubjectKeys([sub("s1", { regulation: "" }), { id: "old", data: { name: "Legacy", code: "L", department: "CSE", semester: 1 } }], courses);
    expect(p.unscoped).toEqual([{ id: "s1", code: "A1", reason: "no regulation" }]);
    expect(p.legacy).toEqual(["old"]);
  });
});
