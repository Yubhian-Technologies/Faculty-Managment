export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actingUser, authenticate, failure } from "@/lib/certifications/http";
import { markExamCellIssued } from "@/lib/certifications/service";

const EXAM_CELL_ROLES = ["EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL"] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await authenticate(...EXAM_CELL_ROLES);
    const db = getAdminDb();
    const user = await actingUser(db, session);
    const req = await markExamCellIssued(db, user, id);
    return NextResponse.json({ request: req });
  } catch (err) {
    return failure(err, "certificate-requests/[id]/exam-cell PATCH");
  }
}
