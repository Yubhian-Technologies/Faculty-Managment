import * as React from "react";
import { cn, stripLeadingZeros } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

// An Indian mobile number - the only kind of phone number stored anywhere in
// this app (see PHONE_REGEX in lib/validations).
const PHONE_DIGITS = 10;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, onChange, onFocus, onWheel, ...props }, ref) => {
    // Numeric fields across the app initialise to 0, so the box reads "0"
    // before anything is typed and the first keystroke appends to it ("0" +
    // "5" = "05"). Two guards, because neither covers the problem alone:
    //
    //   - select-on-focus (below) makes the first digit replace the "0", but
    //     only when focus arrives by keyboard - on a mouse click the following
    //     mouseup collapses the selection to a caret - and it does nothing for
    //     an edit made later in the field.
    //   - stripping the leading zero on change catches every remaining route,
    //     including click-then-type and mid-edit.
    //
    // Both live here rather than at the call sites: there are ~94 number
    // inputs across ~46 files, all rendering through this component, so a
    // per-form fix would leave gaps and would not cover new forms.
    // stripLeadingZeros is idempotent, so the call sites that already apply it
    // themselves are unaffected.
    //
    // The DOM node's value is rewritten before the handler runs so that the
    // correction sticks even when it produces no state change (typing "0" into
    // a field already holding 0 yields "00" -> "0": same number, no re-render,
    // so nothing else would repaint the box).
    //
    // Phone fields (type="tel") get the same treatment for the same reason.
    // Every phone number this app stores is a 10-digit Indian mobile number,
    // and the fields are spread across ~25 forms in every dashboard - so the
    // rule lives here once instead of each form re-deriving it and a new form
    // forgetting it. Anything that isn't a digit is dropped as it is typed
    // (so a pasted "+91 98765 43210" becomes "9876543210" rather than being
    // rejected) and the value stops at 10. Call sites that already strip
    // digits themselves are unaffected - doing it twice changes nothing.
    const handleChange =
      type === "number" && onChange
        ? (e: React.ChangeEvent<HTMLInputElement>) => {
            const stripped = stripLeadingZeros(e.target.value);
            if (stripped !== e.target.value) e.target.value = stripped;
            onChange(e);
          }
        : type === "tel" && onChange
        ? (e: React.ChangeEvent<HTMLInputElement>) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, PHONE_DIGITS);
            if (digits !== e.target.value) e.target.value = digits;
            onChange(e);
          }
        : onChange;

    return (
      <input
        type={type}
        onChange={handleChange}
        className={cn(
          "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        // Defaults for a phone field, ahead of the {...props} spread so a call
        // site can still override either one.
        inputMode={type === "tel" ? "numeric" : undefined}
        maxLength={type === "tel" ? PHONE_DIGITS : undefined}
        onFocus={(e) => {
          if (type === "number") e.target.select();
          onFocus?.(e);
        }}
        // Scrolling the page with the cursor over a focused number input
        // makes the browser treat the wheel as a spinner drag and silently
        // change the value. Blurring on wheel lets the page scroll normally
        // instead, and only the value is ever set by typing.
        onWheel={
          type === "number"
            ? (e) => {
                e.currentTarget.blur();
                onWheel?.(e);
              }
            : onWheel
        }
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
