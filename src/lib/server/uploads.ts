import {
  deleteWorkspaceFile,
  downloadWorkspaceFile,
  uploadWorkspaceFile,
  workspaceFileExists,
  workspaceFilePath,
} from "./storage";

// Document uploads (freebie deliverables, Knowledge Base files) go browser → Storage directly via
// a signed upload URL (POST /api/uploads), then the owning route receives only the resulting path.
// Routing the bytes through the route itself fails for anything over Vercel's ~4.5MB serverless
// request-body limit, well below the sizes below. Keyed by the storage folder each purpose uses.
export const UPLOAD_PURPOSES = {
  freebies: { maxBytes: 25 * 1024 * 1024 },
  knowledge: { maxBytes: 15 * 1024 * 1024 },
} as const;
export type UploadPurpose = keyof typeof UPLOAD_PURPOSES;

export function isUploadPurpose(value: string): value is UploadPurpose {
  return value in UPLOAD_PURPOSES;
}

// Storage object keys reject many characters a real file name can contain. Only the key is
// sanitized — the original name is still what gets stored in the database and shown to people.
export function safeStorageFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+/, "")
    .slice(-120);
  return cleaned || "file";
}

export function newUploadPath(workspaceId: string, purpose: UploadPurpose, fileName: string) {
  return workspaceFilePath(
    workspaceId,
    purpose,
    crypto.randomUUID(),
    safeStorageFileName(fileName),
  );
}

function uploadError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
}

export interface ResolvedUpload {
  path: string;
  name: string;
  type: string | null;
  size: number;
  // The file's bytes, for routes that need to read its contents. Null only if a directly-uploaded
  // file could not be read back from Storage.
  read: () => Promise<File | null>;
}

// Resolves the uploaded file for a multipart route, in either supported shape:
//   - `uploadedPath` (+ `fileName`, `fileType`): the browser already put the file in Storage via
//     POST /api/uploads. Nothing the client says about it is trusted — the path must sit inside
//     this workspace's folder for this purpose, and existence and size are re-checked in Storage.
//   - `file`: the bytes are in this request (only viable under the serverless body limit).
// Returns null when the form carries no file at all. Throws a Response for an invalid one, which
// every route handler already returns as-is.
export async function resolveFormUpload(
  form: FormData,
  workspaceId: string,
  purpose: UploadPurpose,
): Promise<ResolvedUpload | null> {
  const { maxBytes } = UPLOAD_PURPOSES[purpose];

  const uploadedPath = String(form.get("uploadedPath") ?? "").trim();
  if (uploadedPath) {
    const prefix = `${workspaceId}/${purpose}/`;
    const rest = uploadedPath.startsWith(prefix) ? uploadedPath.slice(prefix.length) : "";
    if (!/^[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/.test(rest) || rest.includes(".."))
      throw uploadError("VALIDATION_ERROR", 422);

    const stored = await workspaceFileExists(uploadedPath);
    if (!stored.exists || !stored.size) throw uploadError("UPLOAD_NOT_FOUND", 422);
    if (stored.size > maxBytes) {
      await deleteWorkspaceFile(uploadedPath);
      throw uploadError("FILE_TOO_LARGE", 413);
    }

    const name =
      String(form.get("fileName") ?? "")
        .trim()
        .slice(0, 255) || rest.slice(rest.indexOf("/") + 1);
    const type =
      String(form.get("fileType") ?? "")
        .trim()
        .slice(0, 255) || null;
    return {
      path: uploadedPath,
      name,
      type,
      size: stored.size,
      read: async () => {
        const blob = await downloadWorkspaceFile(uploadedPath);
        return blob ? new File([blob], name, { type: type ?? "" }) : null;
      },
    };
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > maxBytes) throw uploadError("FILE_TOO_LARGE", 413);
  const path = newUploadPath(workspaceId, purpose, file.name);
  const { error } = await uploadWorkspaceFile(path, file);
  if (error) throw uploadError("UPLOAD_FAILED", 500);
  return {
    path,
    name: file.name,
    type: file.type || null,
    size: file.size,
    read: async () => file,
  };
}
