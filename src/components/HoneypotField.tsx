import { useId } from "react";
import { HONEYPOT_FIELD } from "@/lib/honeypot";

// The hidden field on a public form (see lib/honeypot.ts). It is taken out of view, out of the
// tab order and out of the accessibility tree, and is not a field a browser would auto-fill, so
// nobody using the form meets it. It is positioned off-screen rather than `display: none`,
// which the scripts it is meant for often skip.
export function HoneypotField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -left-[9999px] top-auto h-px w-px overflow-hidden opacity-0"
    >
      <label htmlFor={id}>Leave this field empty</label>
      <input
        id={id}
        type="text"
        name={HONEYPOT_FIELD}
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
