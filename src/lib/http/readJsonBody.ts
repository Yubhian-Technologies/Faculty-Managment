import { NextResponse } from "next/server";

// Request-body parsing that answers 400, not 500, on malformed JSON.
//
// `await request.json()` throws a SyntaxError on a bad body, which every route's
// catch-all turns into a 500 ("Internal error") and a console.error - noise for
// ops and the wrong signal for the client. readJsonBody throws a tagged error
// instead, and badBodyResponse(err) - the first line of the route's catch -
// turns exactly that error into the 400. Anything else falls through untouched.

export class BadJsonBodyError extends Error {
  constructor() {
    super("BAD_JSON_BODY");
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new BadJsonBodyError();
  }
}

export function badBodyResponse(err: unknown): NextResponse | null {
  return err instanceof BadJsonBodyError
    ? NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 })
    : null;
}
