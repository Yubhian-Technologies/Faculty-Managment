import type { CertificateRequest, CertificateSectionOverviewRow, StudentRecord } from "@/types";

// Typed client for /api/college/certificate-requests. Every call throws an
// Error carrying the server's message, so screens can show it as is.

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

const BASE = "/api/college/certificate-requests";

export type ListView = "mine" | "inbox" | "issuance-queue" | "exam-cell-queue";

export const listRequests = async (view: ListView) =>
  (await call<{ requests: CertificateRequest[] }>(`${BASE}?view=${view}`)).requests;

export const getRequest = async (id: string) => (await call<{ request: CertificateRequest }>(`${BASE}/${id}`)).request;

export const getRequestStudent = async (id: string) =>
  (await call<{ student: StudentRecord }>(`${BASE}/${id}/student`)).student;

export const getDepartmentOverview = async () =>
  (await call<{ rows: CertificateSectionOverviewRow[] }>(`${BASE}/overview`)).rows;

export const submitRequest = async (purposeCode: string, purposeOther?: string, reason?: string) =>
  call<{ alreadyExists: boolean; request: CertificateRequest }>(BASE, { method: "POST", body: JSON.stringify({ purposeCode, purposeOther, reason }) });

export const decideRequest = async (id: string, action: "APPROVE" | "REJECT", remarks?: string, branchKey?: string) =>
  (await call<{ request: CertificateRequest }>(`${BASE}/${id}`, { method: "PATCH", body: JSON.stringify({ action, remarks, branchKey }) })).request;

export const cancelRequest = async (id: string) =>
  (await call<{ request: CertificateRequest }>(`${BASE}/${id}`, { method: "PATCH", body: JSON.stringify({ action: "CANCEL" }) })).request;

export const issueCertificate = async (id: string, certificateUrl: string, certificateNumber: string) =>
  (await call<{ request: CertificateRequest }>(`${BASE}/${id}/issue`, { method: "POST", body: JSON.stringify({ certificateUrl, certificateNumber }) })).request;

export const rejectAtIssuance = async (id: string, remarks: string) =>
  (await call<{ request: CertificateRequest }>(`${BASE}/${id}/issue`, { method: "PATCH", body: JSON.stringify({ action: "REJECT", remarks }) })).request;

export const markExamCellIssued = async (id: string) =>
  (await call<{ request: CertificateRequest }>(`${BASE}/${id}/exam-cell`, { method: "PATCH" })).request;

export async function uploadCertificatePdf(requestId: string, blob: Blob): Promise<string> {
  const fd = new FormData();
  fd.append("file", blob, "certificate.pdf");
  fd.append("requestId", requestId);
  const res = await fetch("/api/upload/certificates", { method: "POST", body: fd });
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !json.url) throw new Error(json.error ?? "Upload failed");
  return json.url;
}
