import { describe, it, expect } from "vitest";
import { answeredYes, isOwnDocumentUrl, validateOwnDocumentBody, SELF_DOCUMENT_KINDS } from "@/lib/students/ownDocuments";
import { ROSTER_FIELDS } from "@/lib/students/rosterFields";

const url = (bucket: string, studentId: string) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(`student-documents/${studentId}/abc.pdf`)}?alt=media&token=t`;

describe("self documents are tied to the two Yes/No answers only", () => {
  it("exactly the studied-outside-AP and family-ID answers, both real roster fields", () => {
    expect(SELF_DOCUMENT_KINDS.map((k) => k.answerKey)).toEqual(["studiedOutsideAP", "familyIdLinkedOtherState"]);
    for (const k of SELF_DOCUMENT_KINDS) expect(ROSTER_FIELDS.find((f) => f.key === k.answerKey)?.kind).toBe("yesno");
  });
  it("answeredYes is true only for Yes", () => {
    expect(answeredYes("Yes")).toBe(true);
    expect(answeredYes(" yes ")).toBe(true);
    expect(answeredYes("No")).toBe(false);
    expect(answeredYes("")).toBe(false);
    expect(answeredYes(undefined)).toBe(false);
  });
});

describe("validateOwnDocumentBody", () => {
  const ok = { kind: "STUDIED_OUTSIDE_AP", fileUrl: "u", fileName: "a.pdf", fileType: "application/pdf", fileSize: 10 };
  it("accepts a known kind with a file", () => {
    const r = validateOwnDocumentBody(ok);
    expect(r.ok && r.value.kind).toBe("STUDIED_OUTSIDE_AP");
  });
  it("refuses any other kind (no free-form document types), a missing file, or a non-object", () => {
    expect(validateOwnDocumentBody({ ...ok, kind: "SSC_MEMO" }).ok).toBe(false);
    expect(validateOwnDocumentBody({ ...ok, kind: undefined }).ok).toBe(false);
    expect(validateOwnDocumentBody({ ...ok, fileUrl: "" }).ok).toBe(false);
    expect(validateOwnDocumentBody(null).ok).toBe(false);
  });
  it("drops a bad size instead of storing it", () => {
    const r = validateOwnDocumentBody({ ...ok, fileSize: "big" });
    expect(r.ok && "fileSize" in r.value).toBe(false);
  });
});

describe("isOwnDocumentUrl", () => {
  it("accepts only this student's folder in our bucket", () => {
    expect(isOwnDocumentUrl(url("b", "s1"), "b", "s1")).toBe(true);
    expect(isOwnDocumentUrl(url("b", "s2"), "b", "s1")).toBe(false);
    expect(isOwnDocumentUrl(url("other", "s1"), "b", "s1")).toBe(false);
    expect(isOwnDocumentUrl("https://evil.example/x.pdf", "b", "s1")).toBe(false);
  });
  it("does not let a longer id pass for a shorter one", () => {
    expect(isOwnDocumentUrl(url("b", "s10"), "b", "s1")).toBe(false);
  });
});
