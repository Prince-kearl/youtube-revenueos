import { createServiceSupabaseClient } from "./supabase";

// Everything a creator uploads (knowledge files, freebie deliverables, brand logos) lives in one
// private bucket, keyed by workspace_id as the first path segment (see
// 202609270001_freebie_knowledge_branding_launch.sql's storage.objects RLS policy). Nothing is
// served directly from the bucket — always a short-lived signed URL, generated server-side, even
// for public freebie downloads.
const BUCKET = "workspace-files";

export function workspaceFilePath(workspaceId: string, ...segments: string[]): string {
  return [workspaceId, ...segments].join("/");
}

export async function uploadWorkspaceFile(
  path: string,
  file: File,
): Promise<{ error: string | null }> {
  const service = createServiceSupabaseClient();
  const { error } = await service.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: true,
  });
  return { error: error?.message ?? null };
}

export async function deleteWorkspaceFile(path: string): Promise<void> {
  const service = createServiceSupabaseClient();
  await service.storage.from(BUCKET).remove([path]);
}

export async function deleteWorkspaceFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const service = createServiceSupabaseClient();
  await service.storage.from(BUCKET).remove(paths);
}

export async function signedWorkspaceFileUrl(
  path: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const service = createServiceSupabaseClient();
  const { data, error } = await service.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

// A signed *upload* URL (distinct from signedWorkspaceFileUrl's download URL above) — lets the
// browser PUT a large file (e.g. a pre-publish video) directly to Storage without routing the
// bytes through a Vercel serverless function, which has a small request-body limit and a short
// execution timeout unsuited to real video files. The caller (an API route) must already have
// verified the requester owns `path`'s workspace segment before calling this — this function
// itself performs no authorization, same division of responsibility as uploadWorkspaceFile above.
// Valid for 2 hours (Supabase's fixed default for signed upload URLs).
export async function createWorkspaceSignedUploadUrl(
  path: string,
): Promise<{ signedUrl: string; token: string } | null> {
  const service = createServiceSupabaseClient();
  const { data, error } = await service.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (error || !data) return null;
  return { signedUrl: data.signedUrl, token: data.token };
}

// Server-side existence/size check (HEAD-equivalent) — used to confirm a browser really finished
// uploading to a signed URL before the server trusts the client's "upload complete" signal and
// starts spending AI usage on analyzing it.
export async function workspaceFileExists(
  path: string,
): Promise<{ exists: boolean; size: number | null }> {
  const service = createServiceSupabaseClient();
  const lastSlash = path.lastIndexOf("/");
  const folder = lastSlash === -1 ? "" : path.slice(0, lastSlash);
  const fileName = lastSlash === -1 ? path : path.slice(lastSlash + 1);
  const { data, error } = await service.storage.from(BUCKET).list(folder, {
    search: fileName,
    limit: 1,
  });
  if (error || !data?.length) return { exists: false, size: null };
  const size = (data[0].metadata as { size?: number } | null)?.size ?? null;
  return { exists: true, size };
}
