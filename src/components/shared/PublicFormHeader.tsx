const VISHNU_LOGO_URL = "https://res.cloudinary.com/dl88qtudz/image/upload/v1781675822/vishnulogo_r2jsjl.png";

// Shared banner for public (no-auth) candidate-facing forms - bio-data form
// and offer acceptance. Logo is fixed-width on the left; a same-width spacer
// on the right balances it so the college name sits truly centered on the
// header (not just left-aligned in whatever space is left), while still
// wrapping to a 2nd line (clamped) instead of overflowing for long names.
export function PublicFormHeader({ collegeName }: { collegeName: string }) {
  return (
    <div className="grid grid-cols-[3rem_1fr_3rem] sm:grid-cols-[4rem_1fr_4rem] items-center gap-3 rounded-lg border bg-background p-3 sm:p-5">
      <img
        src={VISHNU_LOGO_URL}
        alt="Vishnu Logo"
        className="h-12 w-12 sm:h-16 sm:w-16 object-contain shrink-0"
      />
      <div className="min-w-0 text-center">
        {/* Fluid size (clamp) so the name grows to fill the available header
            width on wide screens instead of sitting fixed-small, while still
            shrinking on narrow ones and clamping to 2 lines. */}
        <p className="font-bold leading-tight line-clamp-2 break-words text-[clamp(1.125rem,4vw,2rem)]">
          {collegeName}
        </p>
      </div>
      <div aria-hidden="true" />
    </div>
  );
}
