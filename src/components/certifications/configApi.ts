import type { CertificateRequest, CertificateSettings, CertificateTemplate, CertificateTypeConfig, IssuedCertificate } from "@/types";
import type { CatalogEntry } from "@/lib/certifications/configured";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";

// Client for the configurable certificates (catalogue, apply, approvals, issue, register, setup). Every call throws
// an Error carrying the server's message, so screens show it as is.

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: init?.body instanceof FormData ? init?.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

const REQ = "/api/college/certificate-requests";
const CFG = "/api/college/certificate-config";

export type { CatalogEntry };
export type SetupType = CertificateTypeConfig & { inUse?: boolean };

export const loadCatalog = () => call<{ entries: CatalogEntry[]; linked: boolean; requests: CertificateRequest[] }>(`${REQ}?view=catalog`);

export interface ApplyInput { typeId: string; purpose?: string; purposeOther?: string; values: Record<string, string>; attachments: { key: string; url: string }[] }
export const applyFor = (input: ApplyInput) => call<{ alreadyExists: boolean; request: CertificateRequest }>(REQ, json("POST", input));

export const resubmitRequest = async (id: string, input: Omit<ApplyInput, "typeId">) =>
  (await call<{ request: CertificateRequest }>(`${REQ}/${id}`, json("PATCH", { action: "RESUBMIT", ...input }))).request;

export const returnRequest = async (id: string, remarks: string, branchKey?: string) =>
  (await call<{ request: CertificateRequest }>(`${REQ}/${id}`, json("PATCH", { action: "RETURN", remarks, branchKey }))).request;

export const previewCertificate = (id: string, issuerValues: Record<string, string>) =>
  call<{ html: string; missing: string[]; uploadOnly: boolean }>(`${REQ}/${id}/preview`, json("POST", { issuerValues }));

export const issueConfigured = async (id: string, body: { issuerValues: Record<string, string>; feeReceiptNo?: string; uploadedUrl?: string }) =>
  (await call<{ request: CertificateRequest }>(`${REQ}/${id}/issue`, json("POST", body))).request;

async function upload(url: string, file: File | Blob, name = "file"): Promise<string> {
  const fd = new FormData();
  fd.append("file", file, file instanceof File ? file.name : name);
  return (await call<{ url: string }>(url, { method: "POST", body: fd })).url;
}
export const uploadAttachment = (file: File) => upload("/api/upload/certificate-attachment", file);
export const uploadSignature = (file: File) => upload("/api/upload/certificate-signature", file);
export const uploadIssuedPdf = (requestId: string, file: File) => upload(`/api/upload/certificate-document?requestId=${encodeURIComponent(requestId)}`, file);

export const loadRegister = async () => (await call<{ certificates: IssuedCertificate[] }>("/api/college/certificates")).certificates;
export const revokeCertificate = async (id: string, reason: string) =>
  (await call<{ certificate: IssuedCertificate }>(`/api/college/certificates/${id}/revoke`, json("POST", { reason }))).certificate;

/** Opens the issued certificate: the frozen page becomes a PDF in the browser; an uploaded one opens as is. */
export async function downloadIssued(issuedId: string): Promise<void> {
  const r = await call<{ certificate: IssuedCertificate; html: string | null; url: string | null }>(`/api/college/certificates/${issuedId}/document`);
  if (r.url) { window.open(r.url, "_blank", "noopener"); return; }
  if (!r.html) throw new Error("The certificate's copy could not be found");
  let html = r.html;
  if (r.certificate.revoked) {
    html = html.replace('<div class="page">', '<div class="page"><div class="preview" style="color:rgba(200,0,0,.18)">REVOKED</div>');
  }
  await renderHtmlToPdf(html, `${r.certificate.typeName} ${r.certificate.certificateNumber}`.replace(/[^A-Za-z0-9 _-]+/g, "_") + ".pdf");
}

export const loadSetup = () => call<{ types: SetupType[]; templates: CertificateTemplate[]; settings: CertificateSettings }>(CFG);
export const saveType = async (type: Partial<CertificateTypeConfig>, id?: string) =>
  (await call<{ type: CertificateTypeConfig }>(id ? `${CFG}/types/${id}` : `${CFG}/types`, json(id ? "PATCH" : "POST", type))).type;
export const deleteType = (id: string) => call<{ ok: true }>(`${CFG}/types/${id}`, json("DELETE"));
export const saveTemplate = async (t: Partial<CertificateTemplate>, id?: string) =>
  (await call<{ template: CertificateTemplate }>(id ? `${CFG}/templates/${id}` : `${CFG}/templates`, json(id ? "PATCH" : "POST", t))).template;
export const deleteTemplate = (id: string) => call<{ ok: true }>(`${CFG}/templates/${id}`, json("DELETE"));
export const saveSignatures = (signatures: CertificateSettings["signatures"]) => call<{ settings: CertificateSettings }>(`${CFG}/settings`, json("PUT", { signatures }));
export const installCatalog = () => call<{ added: { types: number; templates: number } }>(`${CFG}/install`, json("POST"));

export interface StaffOption { uid: string; name: string; role: string }
export const loadStaff = async () => (await call<{ users: StaffOption[] }>("/api/college/users?allDepts=true")).users;
