import type { Firestore } from "firebase-admin/firestore";
import type { CertificateSignature } from "@/types";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { loadTemplates, loadTypes, typesCol } from "./store";
import { cleanTypeConfig } from "./typeConfig";
import { CertificationError } from "./types";
import type { ActingUser } from "./types";

// Shared by the Certificate Setup routes (Principal / College Admin / VP): saving a type checks its template
// exists and its code is the college's only one of that code (the code is part of every certificate number).

export const SETUP_READ_ROLES = ["PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE"] as const;

export async function saveType(db: Firestore, user: ActingUser, raw: unknown, id?: string) {
  const [templates, types] = await Promise.all([loadTemplates(db, user.collegeId), loadTypes(db, user.collegeId)]);
  const clean = cleanTypeConfig(raw, new Set(templates.map((t) => t.id)));
  if (!clean.ok) throw new CertificationError("INVALID", clean.error, 400);
  const clash = types.find((t) => t.code === clean.value.code && t.id !== id);
  if (clash) throw new CertificationError("DUPLICATE_CODE", `The code ${clean.value.code} is already used by "${clash.name}"`, 409);
  const existing = id ? types.find((t) => t.id === id) : undefined;
  if (id && !existing) throw new CertificationError("NOT_FOUND", "Certificate type not found", 404);
  const ref = id ? typesCol(db, user.collegeId).doc(id) : typesCol(db, user.collegeId).doc();
  const data = {
    ...clean.value, ...(existing?.catalogKey ? { catalogKey: existing.catalogKey } : {}),
    updatedAt: new Date().toISOString(), updatedByName: user.name,
  };
  // Optional keys left empty are removed rather than kept from before.
  const stored = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  await ref.set(stored);
  await writeAuditLogSafe(db, user.collegeId, {
    action: "CERTIFICATE_CONFIG_CHANGED", performedBy: user.uid, performedByName: user.name, targetId: ref.id,
    details: { what: id ? "type updated" : "type added", name: clean.value.name, active: clean.value.isActive },
  });
  return { id: ref.id, ...stored };
}

export function cleanSignatures(raw: unknown, collegeId: string): CertificateSignature[] {
  if (!Array.isArray(raw)) throw new CertificationError("INVALID", "signatures must be a list", 400);
  if (raw.length > 10) throw new CertificationError("INVALID", "At most 10 signatures", 400);
  const prefix = encodeURIComponent(`certificate-signatures/${collegeId}/`);
  return raw.map((s, i) => {
    const r = (s ?? {}) as Partial<CertificateSignature>;
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 80) : "";
    const designation = typeof r.designation === "string" ? r.designation.trim().slice(0, 80) : "";
    const imageUrl = typeof r.imageUrl === "string" ? r.imageUrl : "";
    if (!designation) throw new CertificationError("INVALID", `Signature ${i + 1}: give the designation (e.g. Principal)`, 400);
    if (imageUrl && !imageUrl.includes(`/o/${prefix}`)) throw new CertificationError("INVALID", `Signature ${i + 1}: upload the image again`, 400);
    const id = typeof r.id === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(r.id) ? r.id : `sig${Date.now().toString(36)}${i}`;
    return { id, name, designation, imageUrl };
  });
}
