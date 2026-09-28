# M9 — Test Coverage & Gaps (as-is)

## Existing
- None module-specific (no circular/feedback test files in inventory).

## Missing
1. Permission-doc enforcement (create/publish allow/deny matrix).
2. Audience resolution (employeeType × departments × students REGULAR).
3. Publish idempotency + double-notification prevention.
4. Public feedback validation/token checks.

## Risky untested
- Nav-vs-permission-doc mismatch (HOD sees composer but lacks right) — UX bug class.
- Student access to circular viewer.
