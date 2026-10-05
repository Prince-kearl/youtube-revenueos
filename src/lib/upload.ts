import { IS_LOCAL_DEMO } from "@/lib/demo-youtube";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export type UploadPurpose = "freebies" | "knowledge";

// Uploads a document straight from the browser to Storage and adds a reference to it to `form`,
// in place of the file's bytes — the API route then reads `uploadedPath` instead of `file` (see
// resolveFormUpload in lib/server/uploads.ts). Sending the bytes through the API route itself
// fails for anything over the host's ~4.5MB request-body limit. Throws an Error whose message is
// an API error code (FILE_TOO_LARGE, UPLOAD_FAILED, ...), same convention as the fetch callers.
export async function attachDirectUpload(
  form: FormData,
  purpose: UploadPurpose,
  file: File,
): Promise<void> {
  // Demo mode answers API calls in the browser and has no real Storage to upload to.
  if (IS_LOCAL_DEMO) {
    form.set("file", file);
    return;
  }
  const response = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ purpose, fileName: file.name, fileSize: file.size }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    data?: { path: string; token: string };
    error?: string;
  };
  if (!response.ok || !body.data) throw new Error(body.error ?? "UPLOAD_FAILED");

  const { error } = await getSupabaseBrowserClient()
    .storage.from("workspace-files")
    .uploadToSignedUrl(body.data.path, body.data.token, file, {
      contentType: file.type || "application/octet-stream",
    });
  if (error) throw new Error("UPLOAD_FAILED");

  form.set("uploadedPath", body.data.path);
  form.set("fileName", file.name);
  form.set("fileType", file.type);
}
