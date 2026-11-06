export class ApiRequestError extends Error {
  constructor(readonly status: number) {
    super(`API request failed with status ${status}`);
    this.name = "ApiRequestError";
  }
}

/** Fetch JSON without retaining response payloads in errors or logs. */
export async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  const response = await fetch(input, { ...init, headers });
  if (!response.ok) throw new ApiRequestError(response.status);

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiRequestError(502);
  }
}
