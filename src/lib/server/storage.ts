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
