import { describe, expect, it } from "vitest";
import { personalPatchBody } from "./personalRecord";
import { buildPersonalDetailsUpdate } from "@/lib/firestore/personalDetails";
import { diffAcademicProfile } from "./academicProfileChanges";
import type { FacultyEditRecord } from "@/components/faculty/FacultyProfileModuleEditor";

describe("clearing a selection actually clears what is stored", () => {
  it("a cleared Differently Abled answer is sent as null, not dropped", () => {
    const body = personalPatchBody({ differentlyAbled: undefined } as FacultyEditRecord);
    expect("differentlyAbled" in JSON.parse(JSON.stringify(body))).toBe(true);
    expect(buildPersonalDetailsUpdate(body).differentlyAbled).toBeNull();
  });

  it("a cleared text select is written as an empty string", () => {
    const updates = buildPersonalDetailsUpdate({ bloodGroup: "", maritalStatus: "", religion: "" });
    expect(updates).toMatchObject({ bloodGroup: "", maritalStatus: "", religion: "" });
  });

  it("a top-level academic key that was cleared is removed, not kept", () => {
    const changes = diffAcademicProfile({ netSletSetGateOthers: "YES", qualifiedExam: "NET" }, { qualifiedExam: "NET" });
    expect(changes.remove).toEqual(["netSletSetGateOthers"]);
    expect(changes.set).toEqual({});
  });
});
