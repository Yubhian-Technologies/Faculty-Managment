import * as React from "react";
import { cn, stripLeadingZeros } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, onChange, onFocus, ...props }, ref) => {
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
    const handleChange =
      type === "number" && onChange
        ? (e: React.ChangeEvent<HTMLInputElement>) => {
            const stripped = stripLeadingZeros(e.target.value);
            if (stripped !== e.target.value) e.target.value = stripped;
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
        onFocus={(e) => {
          if (type === "number") e.target.select();
          onFocus?.(e);
        }}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
