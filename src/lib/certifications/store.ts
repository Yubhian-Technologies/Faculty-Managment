import type { Firestore } from "firebase-admin/firestore";
import type { CertificateSettings, CertificateTemplate, CertificateTypeConfig, IssuedCertificate } from "@/types";
import { starterCatalog } from "./catalog";

// Where the configurable certificates live, and the reads every route shares.

const college = (db: Firestore, c: string) => db.collection("colleges").doc(c);
export const typesCol = (db: Firestore, c: string) => college(db, c).collection("certificateTypes");
export const templatesCol = (db: Firestore, c: string) => college(db, c).collection("certificateTemplates");
export const settingsDoc = (db: Firestore, c: string) => college(db, c).collection("certificateSettings").doc("main");
export const issuedCol = (db: Firestore, c: string) => college(db, c).collection("issuedCertificates");
export const issuedDocumentDoc = (db: Firestore, c: string, issuedId: string) => issuedCol(db, c).doc(issuedId).collection("files").doc("document");
export const countersCol = (db: Firestore, c: string) => college(db, c).collection("certificateCounters");
/** Root: the public QR check reads one document by its code, with no college known in advance. */
export const verificationsCol = (db: Firestore) => db.collection("certificateVerifications");

export async function loadTypes(db: Firestore, c: string): Promise<CertificateTypeConfig[]> {
  const snap = await typesCol(db, c).get();
  return snap.docs.map((d) => ({ ...(d.data() as Omit<CertificateTypeConfig, "id">), id: d.id })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadType(db: Firestore, c: string, id: string): Promise<CertificateTypeConfig | null> {
  const d = await typesCol(db, c).doc(id).get();
  return d.exists ? { ...(d.data() as Omit<CertificateTypeConfig, "id">), id: d.id } : null;
}

export async function loadTemplates(db: Firestore, c: string): Promise<CertificateTemplate[]> {
  const snap = await templatesCol(db, c).get();
  return snap.docs.map((d) => ({ ...(d.data() as Omit<CertificateTemplate, "id">), id: d.id })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadTemplate(db: Firestore, c: string, id: string): Promise<CertificateTemplate | null> {
  const d = await templatesCol(db, c).doc(id).get();
  return d.exists ? { ...(d.data() as Omit<CertificateTemplate, "id">), id: d.id } : null;
}

export async function loadSettings(db: Firestore, c: string): Promise<CertificateSettings> {
  const d = await settingsDoc(db, c).get();
  const s = d.data() as Partial<CertificateSettings> | undefined;
  return { signatures: Array.isArray(s?.signatures) ? s!.signatures : [] };
}

export async function loadIssued(db: Firestore, c: string, id: string): Promise<IssuedCertificate | null> {
  const d = await issuedCol(db, c).doc(id).get();
  return d.exists ? { ...(d.data() as Omit<IssuedCertificate, "id">), id: d.id } : null;
}

/**
 * Adds the starter catalogue entries the college doesn't have yet (matched by document id). Never overwrites an
 * existing type or template, so re-running it after edits changes nothing that was already installed.
 */
export async function installStarterCatalog(db: Firestore, c: string, byName: string): Promise<{ types: number; templates: number }> {
  const items = starterCatalog();
  const now = new Date().toISOString();
  const [typeSnaps, templateSnaps] = await Promise.all([
    db.getAll(...items.map((i) => typesCol(db, c).doc(i.typeId))),
    db.getAll(...items.map((i) => templatesCol(db, c).doc(i.templateId))),
  ]);
  const batch = db.batch();
  let types = 0, templates = 0;
  items.forEach((item, i) => {
    if (!templateSnaps[i].exists) { batch.create(templatesCol(db, c).doc(item.templateId), { ...item.template, updatedAt: now }); templates++; }
    // A type is added only with its own template, or onto the one already there.
    if (!typeSnaps[i].exists) { batch.create(typesCol(db, c).doc(item.typeId), { ...item.type, updatedAt: now, updatedByName: byName }); types++; }
  });
  if (types + templates > 0) await batch.commit();
  return { types, templates };
}

/** Puts one installed starter type (and its template) back to the starter version - only while nobody has used it. */
export async function resetToStarter(db: Firestore, c: string, typeId: string, byName: string): Promise<void> {
  const current = await loadType(db, c, typeId);
  const item = current?.catalogKey ? starterCatalog().find((i) => i.type.catalogKey === current.catalogKey) : undefined;
  if (!current || !item) throw new Error("NOT_STARTER");
  const used = await db.collection("colleges").doc(c).collection("certificateRequests").where("certificateTypeId", "==", typeId).limit(1).get();
  if (!used.empty) throw new Error("IN_USE");
  const now = new Date().toISOString();
  const batch = db.batch();
  batch.set(templatesCol(db, c).doc(item.templateId), { ...item.template, updatedAt: now });
  batch.set(typesCol(db, c).doc(typeId), { ...item.type, templateId: item.templateId, isActive: current.isActive, updatedAt: now, updatedByName: byName });
  await batch.commit();
}
