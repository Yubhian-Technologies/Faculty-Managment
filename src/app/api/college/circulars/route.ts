export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { createCircular, listCirculars } from "@/lib/circular/service";
import { canSendCircular } from "@/lib/circular/permissions";

// GET ?status=DRAFT|PUBLISHED — published visible to all college members; drafts only to sender/principal
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "PANEL_MEMBER", "COLLEGE_OFFICE", "COLLEGE_STAFF", "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "LIBRARY", "EXAM_CELL", "WEBMASTER", "COLLEGE_ACCOUNTS");
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status")?.trim() || undefined;
    const db = getAdminDb();
    const docs = await listCirculars(db, session.collegeId, { status });
    // Hide drafts not owned by caller unless principal
    const isPrincipal = session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL";
    const filtered = docs.filter((d) => d.status !== "DRAFT" || isPrincipal || d.createdBy === session.uid);
    return NextResponse.json({ circulars: filtered });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[circulars GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "PANEL_MEMBER", "COLLEGE_OFFICE", "COLLEGE_STAFF", "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "LIBRARY", "EXAM_CELL", "WEBMASTER", "COLLEGE_ACCOUNTS");
    const db = getAdminDb();
    const ok = await canSendCircular(db, session.collegeId, session.uid, session.role as never, (session as unknown as { realRole?: string }).realRole as never);
    if (!ok) return NextResponse.json({ error: "Not allowed to send circulars. Contact Principal." }, { status: 403 });
    const body = (await request.json()) as {
      subject?: string; body?: string; date?: string; employeeType?: string; departmentIds?: string[]; departmentNames?: string[]; messageFrom?: string; attachments?: { fileName: string; fileUrl: string; fileType?: string; fileSize?: number }[];
    };
    const date = body.date ? new Date(body.date) : new Date();
    const circular = await createCircular(db, {
      collegeId: session.collegeId,
      subject: body.subject ?? "",
      body: body.body ?? "",
      date,
      audience: {
        employeeType: (body.employeeType as never) ?? "ALL",
        departmentIds: body.departmentIds ?? [],
        departmentNames: body.departmentNames ?? [],
      },
      messageFrom: body.messageFrom ?? "Principal",
      attachments: body.attachments ?? [],
      createdBy: session.uid,
      createdByName: (session as unknown as { name?: string }).name ?? "",
      createdByRole: session.role,
    });
    return NextResponse.json({ circular }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof Error && err.message.includes("required")) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[circulars POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
