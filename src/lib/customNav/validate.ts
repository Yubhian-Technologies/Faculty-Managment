import { z } from "zod";
import { ROLE_LABELS } from "@/types";
import type { CustomPageBlock, UserRole } from "@/types";
import { NAV_ICON_NAMES } from "@/components/layout/NavIcon";
import { isSafeHref, isSafeImageUrl } from "./safeUrl";

export { isSafeHref, isSafeImageUrl };

export const MAX_BLOCKS = 100;
const VALID_ROLES = Object.keys(ROLE_LABELS) as UserRole[];

const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const href = z.string().trim().refine(isSafeHref, "Use an in-app path like /hod/faculty or an http(s) link");
const short = (max: number) => z.string().trim().min(1).max(max);

export const blockSchema: z.ZodType<CustomPageBlock> = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("heading"), text: short(200), level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ id, type: z.literal("text"), text: z.string().trim().min(1).max(5000) }),
  z.object({ id, type: z.literal("button"), label: short(80), href, variant: z.enum(["primary", "outline"]), newTab: z.boolean().optional() }),
  z.object({
    id, type: z.literal("image"),
    url: z.string().trim().refine(isSafeImageUrl, "Image must be an http(s) URL"),
    alt: z.string().trim().max(200),
    caption: z.string().trim().max(300).optional(),
  }),
  z.object({ id, type: z.literal("divider") }),
  z.object({
    id, type: z.literal("linkList"),
    title: z.string().trim().max(120).optional(),
    links: z.array(z.object({ label: short(120), href, newTab: z.boolean().optional() })).min(1).max(30),
  }),
  z.object({ id, type: z.literal("infoCard"), title: short(120), body: z.string().trim().min(1).max(2000), tone: z.enum(["info", "success", "warning"]) }),
]) as z.ZodType<CustomPageBlock>;

const roles = z.array(z.string()).max(VALID_ROLES.length)
  .refine((rs) => rs.every((r) => (VALID_ROLES as string[]).includes(r)), "Unknown role")
  .transform((rs) => Array.from(new Set(rs)) as UserRole[]);

const iconName = z.string().refine((n) => NAV_ICON_NAMES.includes(n), "Unknown icon");

/** Fields common to creating and saving a page (blocks are optional on create). */
export const pageMetaSchema = z.object({
  title: short(60),
  iconName,
  section: z.string().trim().max(40).optional().transform((s) => s || undefined),
  roles,
  enabled: z.boolean(),
});

export const pageUpdateSchema = pageMetaSchema.extend({
  blocks: z.array(blockSchema).max(MAX_BLOCKS)
    .refine((bs) => new Set(bs.map((b) => b.id)).size === bs.length, "Duplicate block ids"),
});

export const orderSchema = z.object({
  role: z.string().refine((r) => (VALID_ROLES as string[]).includes(r), "Unknown role"),
  order: z.array(z.string().min(1).max(200).startsWith("/")).max(400),
});

export function isValidRole(role: string): role is UserRole {
  return (VALID_ROLES as string[]).includes(role);
}
