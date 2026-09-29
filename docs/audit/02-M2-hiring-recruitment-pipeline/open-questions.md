# M2 — Open Questions

1. Are offer-acceptance/candidate-form path tokens intended as unguessable secrets (UID-like), or should they be explicit tokens with expiry?
2. Should panel scoring enforce one-feedback-per-panelist server-side (idempotent overwrite vs reject)?
3. Is Accounts intended to have scoring visibility, or read-only pipeline?
4. Location hiring: are the location candidate/interview/offer stores separate collections or shared college collections with locationId?
5. What happens to a batch stuck in HOD_FINAL_SETUP (timeout/reassign path)?
6. Should SUPPORTING_STAFF batches surface demo fields at all in UI (currently skipped)?
7. Confirm credentials email content/sender policy for new accounts.
