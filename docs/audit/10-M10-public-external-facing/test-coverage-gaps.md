# M10 — Test Coverage & Gaps (as-is)

## Existing
- None public-route-specific in the test inventory.

## Missing
1. Public endpoints validation + id-not-found paths.
2. Offer-acceptance status guard (double-accept, accept-after-reject).
3. Careers listing filters (only OPEN vacancies?).
4. Location interview page data path (route missing from inventory — confirm).

## Risky untested
- Enumeration/abuse of public POSTs (no rate-limit evidence).
