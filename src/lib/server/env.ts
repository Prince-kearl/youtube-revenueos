type RuntimeEnv = Record<string, unknown>;

function runtimeEnv(): RuntimeEnv {
  const workerEnv = (globalThis as Record<string, unknown>).__env__;
  if (workerEnv && typeof workerEnv === "object") return workerEnv as RuntimeEnv;
  return (typeof process !== "undefined" ? process.env : {}) as RuntimeEnv;
}

export function getServerEnv(name: string): string | undefined {
  const value = runtimeEnv()[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function requireServerEnv(name: string): string {
  const value = getServerEnv(name);
  if (!value) throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}
