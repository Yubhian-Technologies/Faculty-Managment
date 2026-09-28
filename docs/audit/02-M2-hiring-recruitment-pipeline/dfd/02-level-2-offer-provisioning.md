# M2 — DFD Level 2: M2-SM4/S M5 Offer, Acceptance & Provisioning

```mermaid
flowchart TD
    CO["[External Entity] College Office"]
    AC["[External Entity] Accounts"]
    PR["[External Entity] Principal (negotiate)"]
    CAND["[External Entity] Candidate (public)"]
    WM["[External Entity] Webmaster"]

    P41("(4.1 Create Offer (snapshot terms))")
    P42("(4.2 Generate PDF)")
    P43("(4.3 Send + Resolve CC)")
    P44("(4.4 Candidate Accept (public) / staff override)")
    P45("(4.5 Upload Joining Letter)")
    P46("(4.6 Create Appointment Letter)")
    P51("(5.1 Request Faculty Account)")
    P52("(5.2 Fulfill Credentials (email availability check))")
    P53("(5.3 Provision FacultyMember + User)")

    DL[("offerLetters · appointmentLetters")]
    DC[("candidates · candidateApplications")]
    DFR[("facultyAccountRequests · emailRequests")]
    DFM[("facultyMembers · users · systemUsers")]
    PDF["/api/pdf/generate"]
    MAIL["/api/email/send"]

    CO-->P41; PR-->|negotiate|P41
    P41-->|terms snapshot|DL
    P41-->P42-->PDF
    P42-->|pdfUrl|DL
    P43-->|cc list resolved once|MAIL
    CO-->P43
    CAND-->P44-->|ACCEPTED, respondedBy=CANDIDATE|DL
    CO-->P45-->|joiningLetterUrl|DL
    CO-->P46-->DL
    AC-->|verify CTC|P41
    CO-->P51-->DFR
    WM-->P52-->|check-availability|DFR
    P52-->P53-->DFM
    P44-->|notify|DFR
```

*Evidence: OfferLetter status machine + offeredTerms snapshot `recruitment.ts:458-490`; FacultyAccountRequest statuses :520; provisioning tx `facultyProvisioning.ts:119-123,182,208-266`; CC `offerLetterCc.ts:16-31`; decision tx `offerLetterDecision.ts:22-62`.*
