export function getCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = part.slice(0, separatorIndex).trim();
    if (key === name) return decodeURIComponent(part.slice(separatorIndex + 1).trim());
  }
  return undefined;
}

export function parseCookies(request: Request): { name: string; value: string }[] {
  const header = request.headers.get("cookie");
  if (!header) return [];
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separatorIndex = part.indexOf("=");
      return separatorIndex === -1
        ? { name: part, value: "" }
        : { name: part.slice(0, separatorIndex), value: decodeURIComponent(part.slice(separatorIndex + 1)) };
    });
}

export function buildSetCookie(name: string, value: string, options: { maxAge?: number; path?: string } = {}): string {
  const segments = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? "/"}`, "HttpOnly", "SameSite=Lax"];
  if (options.maxAge !== undefined) segments.push(`Max-Age=${options.maxAge}`);
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") segments.push("Secure");
  return segments.join("; ");
}

export function buildExpiredCookie(name: string, path = "/"): string {
  return `${name}=; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=0`;
}
