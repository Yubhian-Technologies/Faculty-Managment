import type { ApprovalRequest } from "@/lib/approvals/types";
import type { PermissionConfig, PermissionLimits, PermissionPayload, PermissionStage } from "@/lib/studentPermissions/types";
import type { PermissionGroup } from "@/lib/studentPermissions/categories";

// Typed client for /api/college/student-permissions. Every call throws an Error
// carrying the server's message, so screens can show it as is.

export type PermissionRequestView = ApprovalRequest<PermissionPayload>;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

const BASE = "/api/college/student-permissions";

export type ListView = "mine" | "inbox" | "oversight";

export const listRequests = async (view: ListView) =>
  (await call<{ requests: PermissionRequestView[] }>(`${BASE}?view=${view}&limit=100`)).requests;

export const createRequest = async (body: unknown) =>
  (await call<{ requests: PermissionRequestView[] }>(BASE, { method: "POST", body: JSON.stringify(body) })).requests;

export type RequestAction = "APPROVE" | "REJECT" | "CANCEL" | "REVOKE" | "RETRY";
export const actOnRequest = async (id: string, action: RequestAction, remark?: string) =>
  (await call<{ request: PermissionRequestView }>(`${BASE}/${id}`, { method: "PATCH", body: JSON.stringify({ action, remark }) })).request;

export interface FormOptions {
  enabled: boolean;
  department: string;
  groups: { id: string; label: string; items: { id: string; label: string; enabled: boolean }[] }[];
  limits: PermissionLimits;
}
export const loadOptions = (department?: string) => call<FormOptions>(`${BASE}/options${department ? `?department=${encodeURIComponent(department)}` : ""}`);

export interface PickerStudent { id: string; rollNumber: string; name: string; department: string; year: number; section: string; hasLogin: boolean }
export interface PickerSection { id: string; department: string; courseName?: string; courseId?: string; year: number; name: string }
export const lookupSections = async () => (await call<{ sections: PickerSection[] }>(`${BASE}/student-lookup?mode=sections`)).sections;
export const lookupRoster = async (sectionId: string) => (await call<{ students: PickerStudent[] }>(`${BASE}/student-lookup?mode=roster&sectionId=${sectionId}`)).students;
export const lookupSearch = async (q: string) => (await call<{ students: PickerStudent[] }>(`${BASE}/student-lookup?mode=search&q=${encodeURIComponent(q)}`)).students;

export interface ConfigPayload {
  config: PermissionConfig;
  departments: string[];
  groups: PermissionGroup[];
  stages: Record<"STUDENT" | "FACULTY", PermissionStage[]>;
  stageLabels: Record<PermissionStage, string>;
  defaults: { limits: PermissionLimits; route: Record<"STUDENT" | "FACULTY", PermissionStage[]> };
  editor: { college: boolean; departments: string[] | "ALL" };
}
export const loadConfig = () => call<ConfigPayload>(`${BASE}/config`);
export const saveConfig = async (config: PermissionConfig) => (await call<{ config: PermissionConfig }>(`${BASE}/config`, { method: "PUT", body: JSON.stringify({ config }) })).config;

export async function uploadProof(file: File): Promise<{ url: string; name: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/upload/student-permission-proof", { method: "POST", body: fd });
  const json = (await res.json().catch(() => ({}))) as { url?: string; name?: string; error?: string };
  if (!res.ok || !json.url) throw new Error(json.error ?? "Upload failed");
  return { url: json.url, name: json.name ?? file.name };
}
