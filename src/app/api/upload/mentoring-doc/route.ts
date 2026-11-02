export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminStorage } from "@/lib/firebase/admin";

// A supporting document for a Mentoring Record row (scholarship letter, internship / placement offer, exam
// scorecard, certificate ...). Uploaded by the student for their own record, or by the mentor / HOD. Same checks as
// upload/student-permission-proof: <= 4 MB, and the file's bytes must really be a PDF, PNG or JPEG. The path is
// scoped to the uploader, never to a client-supplied id; the row only accepts links of this shape (isMentoringDocUrl).
const MAX_SIZE = 4 * 1024 * 1024;

const TYPES: Record<string, { ext: string; contentType: string; magic: number[] }> = {
  pdf: { ext: "pdf", contentType: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  png: { ext: "png", contentType: "image/png", magic: [0x89, 0x50, 0x4e, 0x47] },
  jpg: { ext: "jpg", contentType: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
};

function sniff(buf: Buffer): keyof typeof TYPES | null {
  for (const [key, t] of Object.entries(TYPES)) if (t.magic.every((b, i) => buf[i] === b)) return key as keyof typeof TYPES;
  return null;
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("STUDENT", "PANEL_MEMBER", "HOD");
    let form: FormData;
    try { form = await request.formData(); } catch { return NextResponse.json({ error: "Send the file as multipart form data" }, { status: 400 }); }
    const file = form.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength === 0) return NextResponse.json({ error: "The file is empty" }, { status: 400 });
    if (buffer.byteLength > MAX_SIZE) return NextResponse.json({ error: "File exceeds the 4 MB limit" }, { status: 400 });
    const kind = sniff(buffer);
    if (!kind) return NextResponse.json({ error: "Only PDF, PNG or JPEG files are accepted" }, { status: 400 });

    const { ext, contentType } = TYPES[kind];
    const token = randomUUID();
    const path = `mentoring-docs/${session.collegeId}/${session.uid}/${randomUUID()}.${ext}`;
    const bucket = getAdminStorage().bucket();
    await bucket.file(path).save(buffer, { metadata: { cacheControl: "private, max-age=3600", contentType, metadata: { firebaseStorageDownloadTokens: token } }, resumable: false });

    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    return NextResponse.json({ url, name: (file as File).name || `document.${ext}`, size: buffer.byteLength });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[upload/mentoring-doc POST]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
