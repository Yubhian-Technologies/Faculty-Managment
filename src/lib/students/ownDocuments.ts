// Supporting documents a student uploads for themselves (My Profile > Additional Information): one for "Studied Outside
// Andhra Pradesh? = Yes" and one for "Any Family ID Linked to Another State? = Yes" - and only those two.
// They live in the same `studentDocuments` collection the College Office uses (flagged `selfUploaded`, with the
// `selfUploadKind` below), so the Office sees them on the student's Documents page and the student on My Documents.
// Client-safe: no server imports.

export type SelfDocumentKind = "STUDIED_OUTSIDE_AP" | "FAMILY_ID_OTHER_STATE";

export interface SelfDocumentKindInfo {
  kind: SelfDocumentKind;
  /** The roster field whose "Yes" answer asks for this document. */
  answerKey: "studiedOutsideAP" | "familyIdLinkedOtherState";
  /** Shown on the profile and stored as the document's name. */
  label: string;
}

export const SELF_DOCUMENT_KINDS: SelfDocumentKindInfo[] = [
  { kind: "STUDIED_OUTSIDE_AP", answerKey: "studiedOutsideAP", label: "Studied Outside Andhra Pradesh - Supporting Document" },
  { kind: "FAMILY_ID_OTHER_STATE", answerKey: "familyIdLinkedOtherState", label: "Family ID Linked to Another State - Supporting Document" },
];

export const SELF_DOCUMENT_KIND_BY_KEY = new Map(SELF_DOCUMENT_KINDS.map((k) => [k.kind, k]));

export const MAX_SELF_DOCUMENTS_PER_KIND = 5;
export const MAX_SELF_DESCRIPTION_LENGTH = 300;

/** True when a form/stored answer string means Yes ("Yes", any case). */
export function answeredYes(v: string | undefined | null): boolean {
  return (v ?? "").trim().toLowerCase() === "yes";
}

export interface OwnDocumentInput {
  kind: SelfDocumentKind;
  description?: string;
  fileUrl: string;
  fileName: string;
  fileType?: string;
  fileSize?: number;
}

export type OwnDocumentResult = { ok: true; value: OwnDocumentInput } | { ok: false; error: string };

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Validates the JSON a student sends after the file itself was uploaded. */
export function validateOwnDocumentBody(body: unknown): OwnDocumentResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const kind = clean(b.kind) as SelfDocumentKind;
  if (!SELF_DOCUMENT_KIND_BY_KEY.has(kind)) return { ok: false, error: "Choose which answer this document supports" };
  const fileUrl = clean(b.fileUrl);
  const fileName = clean(b.fileName);
  if (!fileUrl || !fileName) return { ok: false, error: "fileUrl and fileName are required" };
  const description = clean(b.description);
  if (description.length > MAX_SELF_DESCRIPTION_LENGTH) return { ok: false, error: `Description must be ${MAX_SELF_DESCRIPTION_LENGTH} characters or fewer` };
  const fileSize = typeof b.fileSize === "number" && Number.isFinite(b.fileSize) && b.fileSize >= 0 ? b.fileSize : undefined;
  const fileType = clean(b.fileType);
  return {
    ok: true,
    value: {
      kind,
      ...(description ? { description } : {}),
      fileUrl,
      fileName: fileName.slice(0, 200),
      ...(fileType ? { fileType } : {}),
      ...(fileSize !== undefined ? { fileSize } : {}),
    },
  };
}

/**
 * True only for a file this student's own upload produced: the Storage download URL of
 * `student-documents/{studentId}/...` in our bucket. Stops a student pointing a "document" at any other address
 * (another student's file, an external site).
 */
export function isOwnDocumentUrl(url: string, bucketName: string, studentId: string): boolean {
  const prefix = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(`student-documents/${studentId}/`)}`;
  return url.startsWith(prefix);
}
