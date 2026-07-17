// Thin wrapper around Playwright's APIRequestContext, pre-authenticated as a
// given test role. Used by the API-level spec files (tests/e2e/api/**) to
// drive the budget/indent state machines directly against the route
// handlers — faster and far less flaky than clicking through the UI for
// every one of the ~70 cases in the QA matrix, while still exercising real
// Next.js route code (no mocking).

import { request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { sessionCookieHeader } from "./session";
import type { TestUser } from "./testUsers";

export class ApiClient {
  private constructor(private ctx: APIRequestContext, private user: TestUser) {}

  static async as(baseURL: string, user: TestUser): Promise<ApiClient> {
    const ctx = await playwrightRequest.newContext({
      baseURL,
      extraHTTPHeaders: { Cookie: sessionCookieHeader(user) },
    });
    return new ApiClient(ctx, user);
  }

  get raw(): APIRequestContext {
    return this.ctx;
  }

  // Appends ?collegeId= for GLOBAL roles (FINANCE/PURCHASE_DEPT/MANAGEMENT)
  // whose session carries no collegeId — mirrors what the real college
  // switcher does client-side (see requireCollegeContext in verifySession.ts).
  private withCollegeParam(path: string): string {
    if (!this.user.collegeId) return path;
    const needsCollegeParam = this.user.role === "FINANCE" || this.user.role === "PURCHASE_DEPT";
    if (!needsCollegeParam) return path;
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}collegeId=${encodeURIComponent(this.user.collegeId)}`;
  }

  get(path: string) {
    return this.ctx.get(this.withCollegeParam(path));
  }

  post(path: string, data: unknown) {
    return this.ctx.post(this.withCollegeParam(path), { data });
  }

  patch(path: string, data: unknown) {
    return this.ctx.patch(this.withCollegeParam(path), { data });
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}
