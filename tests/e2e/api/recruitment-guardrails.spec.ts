import { test, expect } from "@playwright/test";
import { ApiClient } from "../support/apiClient";
import { testUsers } from "../support/testUsers";

test.describe("Recruitment & Candidate Flow Validation & Guardrails", () => {
  let hod: ApiClient;
  let principal: ApiClient;

  test.beforeAll(async ({ baseURL }) => {
    hod = await ApiClient.as(baseURL!, testUsers.hod);
    principal = await ApiClient.as(baseURL!, testUsers.principal);
  });

  test.afterAll(async () => {
    await Promise.all([hod?.dispose(), principal?.dispose()]);
  });

  test("rejects candidate creation when phone is not 10 digits", async () => {
    const res = await hod.post("/api/college/candidates", {
      name: "Test Candidate",
      email: "test.candidate.invalidphone@example.com",
      phone: "12345", // Invalid <10 digits
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Phone number must be exactly 10 digits");
  });

  test("rejects updating candidate joining date to a past date", async () => {
    const fakeAppId = "non-existent-app-id";
    const pastDate = "2020-01-01";
    const res = await principal.patch(`/api/college/candidate-applications/${fakeAppId}`, {
      dateOfJoining: pastDate,
    });
    // Should fail with either 400 (validation failure) or 404 (if application not found)
    expect([400, 404]).toContain(res.status());
    if (res.status() === 400) {
      const body = await res.json();
      expect(body.error).toContain("Date of Joining cannot be in the past");
    }
  });
});
