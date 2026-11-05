import { randomUUID } from "crypto";
import { getAdminStorage } from "@/lib/firebase/admin";
import { CertificationError } from "./types";

// Reads one uploaded file and stores it under a path built only from the session / the request - never a
// client-supplied name. The bytes decide the type (a renamed file is refused).

const kindOf = (b: Buffer): "pdf" | "png" | "jpg" | null => {
  if (b.length > 4 && b.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (b.length > 8 && b[0] === 0x89 && b.subarray(1, 4).toString("latin1") === "PNG") return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  return null;
};
const TYPE = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg" } as const;

export async function storeUpload(request: Request, folder: string, allowed: ("pdf" | "png" | "jpg")[], maxBytes: number): Promise<{ url: string; form: FormData }> {
  let form: FormData;
  try { form = await request.formData(); } catch { throw new CertificationError("INVALID", "Send the file as multipart form data", 400); }
  const file = form.get("file");
  if (!file || typeof file === "string") throw new CertificationError("INVALID", "No file provided", 400);
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength === 0) throw new CertificationError("INVALID", "The file is empty", 400);
  if (buffer.byteLength > maxBytes) throw new CertificationError("INVALID", `The file must be ${Math.round(maxBytes / 1024 / 1024 * 10) / 10} MB or smaller`, 400);
  const kind = kindOf(buffer);
  if (!kind || !allowed.includes(kind)) throw new CertificationError("INVALID", `Only ${allowed.map((a) => a.toUpperCase()).join(" / ")} files are accepted`, 400);
  const token = randomUUID();
  const path = `${folder}/${randomUUID()}.${kind}`;
  const bucket = getAdminStorage().bucket();
  await bucket.file(path).save(buffer, { metadata: { contentType: TYPE[kind], metadata: { firebaseStorageDownloadTokens: token } }, resumable: false });
  return { url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`, form };
}
