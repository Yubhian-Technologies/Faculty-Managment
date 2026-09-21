import { describe, expect, it } from "vitest";
import { facultyDisplayName } from "./facultyDisplayName";
import { buildPersonalDetailsUpdate } from "@/lib/firestore/personalDetails";
import { personalPatchBody, personalRecordFromDoc } from "./personalRecord";

describe("facultyDisplayName", () => {
  it("is legalName only", () => {
    expect(facultyDisplayName({ legalName: "  ANITHA REDDY " })).toBe("ANITHA REDDY");
  });

  it("never falls back to the legacy `name` key or to nameAsPerPan", () => {
    // Extra keys are passed through an untyped record on purpose - that is what a raw Firestore doc looks like.
    const raw = { name: "Dr. Legacy Name", nameAsPerPan: "PAN NAME" } as Record<string, unknown>;
    expect(facultyDisplayName(raw as { legalName?: string })).toBe("");
  });

  it("handles missing records", () => {
    expect(facultyDisplayName(undefined)).toBe("");
    expect(facultyDisplayName(null)).toBe("");
  });
});

describe("nameAsPerPan (independent of legalName, like nameAsPerAadhar)", () => {
  it("is written by the shared personal-details builder only when sent", () => {
    expect(buildPersonalDetailsUpdate({ nameAsPerPan: "PRIYA NAIR" })).toMatchObject({ nameAsPerPan: "PRIYA NAIR" });
    expect("nameAsPerPan" in buildPersonalDetailsUpdate({ legalName: "PRIYA NAIR" })).toBe(false);
  });

  it("an explicit empty string clears it without touching legalName", () => {
    const out = buildPersonalDetailsUpdate({ nameAsPerPan: "" });
    expect(out.nameAsPerPan).toBe("");
    expect("legalName" in out).toBe(false);
  });

  it("round-trips through the Personal Details edit record and never derives from legalName", () => {
    const rec = personalRecordFromDoc({ legalName: "PRIYA NAIR" }) as Record<string, unknown>;
    expect(rec.nameAsPerPan).toBe("");
    const body = personalPatchBody(personalRecordFromDoc({ legalName: "A", nameAsPerPan: "B" }) as never);
    expect(body.nameAsPerPan).toBe("B");
    expect(body.legalName).toBe("A");
  });
});
