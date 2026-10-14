// The honeypot on the public forms (lead-magnet opt-in, landing-page contact).
//
// Each form carries one extra field that people never see, reach by keyboard or have read to
// them. Scripts that fill in every input fill it too. The server then answers exactly as it
// would for a real submission — and records nothing.
//
// Shared by the forms (which render the field) and the routes (which read it).

/** Deliberately not a name a browser or password manager would auto-fill. */
export const HONEYPOT_FIELD = "hp_reference";

/** True when the hidden field came back with something in it. */
export function honeypotTriggered(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
