# Flow — M7-F2: Indent (Goods & Non-Goods) + Purchase Clearance

- **Flow ID:** M7-F2
- **Actors:** HOD, Purchase Dept (GLOBAL), Finance (GLOBAL), Principal (oversight)
- **Trigger:** HOD raises indent (`/hod/indents/new`, IndentForm defaultIndentRequestType)
- **Preconditions:** items defined (IndentItem indent.ts:60+); goods need quotations before Finance
- **Main success scenario (GOODS):**
  1. `POST /api/college/indent-requests` → PENDING_PURCHASE_REVIEW (indent.ts:37).
  2. Purchase reviews (`/purchase/pending`): adds ≥3 quotations, selects 1 → PENDING_FINANCE_REVIEW (:42).
  3. Finance approves → APPROVED + **auto-creates FinancePayment** ("green flag" comment :46) → Purchase buys, uploads GRN (`upload/purchase-grn`) + indent-receipt → COMPLETED.
- **Main success scenario (NON-GOODS):** HOD submits → PENDING_FINANCE_REVIEW directly → Finance approves & disburses → COMPLETED (:47-48).
- **Alternate/error:** returns (RETURNED_TO_HOD from Purchase or Finance :40; RETURNED_TO_PURCHASE from Finance :43); rejections (REJECTED_BY_PURCHASE :38; REJECTED :45).
- **UI:** `/hod/indents*`, `/purchase/{indents,pending,latest,by-category,by-type,clearance/[id]}`, `/finance/indent-approvals`, `/finance/purchase-clearance*`, `/principal/indents*`, `/management/indents`.
- **API:** `indent-requests*`, `finance-purchase-clearance*`, `purchase/indents/overview`, uploads.
- **Backend:** route logic + notify (finance-purchase-clearance callsites in notify referencedBy).
- **DB:** indentRequests, financePurchaseClearance, financePayments.
- **Permissions:** stage-gated; GLOBAL roles college-contextual.
- **Validation:** ≥3 quotations + 1 selected before Finance (goods); totals via indentItemsTotal/indentItemTotal.
- **State transitions:** 8 states (indent.ts:36-48), 3 terminal (REJECTED_BY_PURCHASE, REJECTED, COMPLETED).
- **Side effects:** FinancePayment auto-creation; notifications; uploads.
- **Code evidence:** cited; 15 UI/API files use indentItemsTotal (referencedBy).
