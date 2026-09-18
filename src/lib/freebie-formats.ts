export const FREEBIE_FORMATS = [
  { id: "cheatsheet", label: "Cheatsheet" },
  { id: "guide", label: "Mini-Guide" },
  { id: "list", label: "Resource List" },
  { id: "checklist", label: "Actionable Checklist" },
  { id: "upload", label: "Uploaded File" },
] as const;

export function freebieFormatLabel(id: string): string {
  return FREEBIE_FORMATS.find((f) => f.id === id)?.label ?? id;
}
