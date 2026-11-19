"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { isoToDmyText, dmyTextToIso, typeDmy } from "@/lib/utils/dateField";

type Props = React.InputHTMLAttributes<HTMLInputElement>;

// The site's date box (DD/MM/YYYY), used by <Input type="date"> everywhere. A browser's own date box shows the
// laptop's region format (often MM/DD/YYYY), so it is never shown: people type DD/MM/YYYY into a text box, or pick from
// the browser's calendar (the calendar button opens it). The VALUE stays exactly what a native date box gives -
// "YYYY-MM-DD", or "" while incomplete - so no form, API or saved data changes.
//
// A hidden native date input carries the value: the forwarded ref, `name`, and the change event's `target` are that
// element, so `e.target.value`, react-hook-form's register() and plain refs all keep working. A value written to it
// from outside (react-hook-form's reset / default values) is mirrored into the text box.

const VALUE = typeof window !== "undefined" ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value") : undefined;

// Width / layout classes belong to the outer box (so the calendar button sits inside the field), the rest to the text box.
const OUTER = /^(?:[a-z]+:)*(?:w-|min-w-|max-w-|flex-|basis-|shrink|grow|col-span|row-span|self-|justify-self-|order-|m[trblxy]?-|-m[trblxy]?-)/;

export const DateField = React.forwardRef<HTMLInputElement, Props>(function DateField(
  { className, value, defaultValue, onChange, onBlur, min, max, name, id, required, disabled, readOnly, placeholder, style, ...rest },
  ref,
) {
  const nativeRef = React.useRef<HTMLInputElement | null>(null);
  const writing = React.useRef(false);
  const [text, setText] = React.useState(() => isoToDmyText(String(value ?? defaultValue ?? "")));

  // A controlled value changed from outside (not by this box): show it.
  const [seen, setSeen] = React.useState(value);
  if (value !== seen) {
    setSeen(value);
    const next = String(value ?? "");
    if (next !== dmyTextToIso(text)) setText(isoToDmyText(next));
  }

  const setNative = (iso: string) => {
    const node = nativeRef.current;
    if (!node || !VALUE?.set) return;
    writing.current = true;
    VALUE.set.call(node, iso);
    writing.current = false;
  };

  const attach = React.useCallback(
    (node: HTMLInputElement | null) => {
      nativeRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
      if (!node || !VALUE?.get || !VALUE.set) return;
      const get = VALUE.get, set = VALUE.set;
      Object.defineProperty(node, "value", {
        configurable: true,
        get() { return get.call(node); },
        set(v: unknown) {
          set.call(node, v);
          if (!writing.current) setText(isoToDmyText(String(v ?? "")));
        },
      });
    },
    [ref],
  );

  // Starting value of an uncontrolled / react-hook-form field.
  React.useEffect(() => {
    const start = String(value ?? defaultValue ?? "");
    if (start && nativeRef.current && !nativeRef.current.value) setNative(start);
    // Only on mount: later values arrive through `value` or the patched setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fire = (type: "change" | "blur", nativeEvent: Event) => {
    const node = nativeRef.current;
    if (!node) return;
    const evt = {
      target: node, currentTarget: node, type, nativeEvent, bubbles: true, defaultPrevented: false,
      preventDefault() {}, stopPropagation() {}, persist() {}, isDefaultPrevented: () => false, isPropagationStopped: () => false,
    };
    if (type === "change") onChange?.(evt as unknown as React.ChangeEvent<HTMLInputElement>);
    else onBlur?.(evt as unknown as React.FocusEvent<HTMLInputElement>);
  };

  const onType = (e: React.ChangeEvent<HTMLInputElement>) => {
    const shown = typeDmy(e.target.value);
    setText(shown);
    const iso = dmyTextToIso(shown);
    if (iso !== (nativeRef.current?.value ?? "")) {
      setNative(iso);
      fire("change", e.nativeEvent);
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(isoToDmyText(e.target.value));
    onChange?.(e);
  };

  const openCalendar = () => {
    const node = nativeRef.current;
    if (!node) return;
    try { node.showPicker(); } catch { node.focus(); }
  };

  const classes = (className ?? "").split(/\s+/).filter(Boolean);
  const outer = classes.filter((c) => OUTER.test(c)).join(" ");
  const inner = classes.filter((c) => !OUTER.test(c)).join(" ");
  const incomplete = text !== "" && dmyTextToIso(text) === "";

  return (
    <div className={cn("relative w-full", outer)} style={style}>
      <input
        {...rest}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder ?? "DD/MM/YYYY"}
        value={text}
        onChange={onType}
        onBlur={(e) => fire("blur", e.nativeEvent)}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        maxLength={10}
        aria-invalid={incomplete || rest["aria-invalid"] ? true : undefined}
        className={cn(
          "flex h-11 w-full rounded-md border border-input bg-background pl-3 pr-10 py-2 text-sm tabular-nums ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-red-400",
          inner,
        )}
      />
      <input
        ref={attach}
        type="date"
        name={name}
        min={min}
        max={max}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        onChange={onPick}
        className="pointer-events-none absolute bottom-0 right-0 h-full w-10 opacity-0"
      />
      <button
        type="button"
        onClick={openCalendar}
        disabled={disabled || readOnly}
        aria-label="Open Calendar"
        title="Open Calendar"
        className="absolute right-1 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <CalendarDays className="h-4 w-4" />
      </button>
    </div>
  );
});
