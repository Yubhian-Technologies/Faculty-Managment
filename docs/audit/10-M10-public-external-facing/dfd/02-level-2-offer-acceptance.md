# M10 — DFD Level 2: M10-SM3 Offer Acceptance

```mermaid
flowchart TD
    CAND["[External Entity] Candidate (public)"]

    P31("(3.1 Resolve Offer by Path Ids)")
    P32("(3.2 Render Terms Snapshot (offeredTerms))")
    P33("(3.3 Accept/Decline (status machine))")
    P34("(3.4 Confirm Joining Date)")
    P35("(3.5 Notify Office/Webmaster)")

    DL[("offerLetters")]
    DN[("notifications")]

    CAND-->P31
    DL-->P31-->P32-->CAND
    CAND-->P33
    DL-->P33
    P33-->|"ACCEPTED"|P34-->DL
    P33-->P35-->DN
```

*Evidence: `recruitment.ts:458-490` (offeredTerms snapshot, respondedBy=CANDIDATE), `api/public/offer-acceptance/[collegeId]/[offerId]/route.ts`; M2 flow M2-F3.*
