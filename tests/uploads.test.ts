import assert from "node:assert/strict";
import { test } from "node:test";
import { newUploadPath, resolveFormUpload, safeStorageFileName } from "../src/lib/server/uploads";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE = "22222222-2222-4222-8222-222222222222";
const UPLOAD_ID = "33333333-3333-4333-8333-333333333333";

async function rejection(form: FormData): Promise<{ status: number; error: string }> {
  try {
    await resolveFormUpload(form, WORKSPACE, "knowledge");
  } catch (thrown) {
    assert.ok(thrown instanceof Response, "expected a Response to be thrown");
    return { status: thrown.status, error: ((await thrown.json()) as { error: string }).error };
  }
  assert.fail("expected resolveFormUpload to reject");
}

function formWithPath(uploadedPath: string): FormData {
  const form = new FormData();
  form.set("uploadedPath", uploadedPath);
  return form;
}

test("storage file names keep only characters Storage accepts", () => {
  assert.equal(safeStorageFileName("My Lead Magnet (final).pdf"), "My-Lead-Magnet-final-.pdf");
  assert.equal(safeStorageFileName("../../etc/passwd"), "etc-passwd");
  assert.equal(safeStorageFileName("a..b...c.txt"), "a.b.c.txt");
  assert.equal(safeStorageFileName("日本語"), "file");
});

test("new upload paths are scoped to the workspace and purpose", () => {
  const path = newUploadPath(WORKSPACE, "freebies", "Guide v2.pdf");
  assert.match(path, new RegExp(`^${WORKSPACE}/freebies/[0-9a-f-]{36}/Guide-v2\\.pdf$`));
});

test("a form with no file resolves to null", async () => {
  assert.equal(await resolveFormUpload(new FormData(), WORKSPACE, "knowledge"), null);
});

// Every case below must be rejected before Storage is ever consulted — these run with no Supabase
// configuration at all, so reaching Storage would surface as a different (non-422) failure.
test("an uploaded path in another workspace is rejected", async () => {
  const result = await rejection(formWithPath(`${OTHER_WORKSPACE}/knowledge/${UPLOAD_ID}/a.pdf`));
  assert.deepEqual(result, { status: 422, error: "VALIDATION_ERROR" });
});

test("an uploaded path under a different purpose is rejected", async () => {
  const result = await rejection(formWithPath(`${WORKSPACE}/freebies/${UPLOAD_ID}/a.pdf`));
  assert.deepEqual(result, { status: 422, error: "VALIDATION_ERROR" });
});

test("path traversal and extra segments are rejected", async () => {
  for (const path of [
    `${WORKSPACE}/knowledge/../../${OTHER_WORKSPACE}/knowledge/${UPLOAD_ID}/a.pdf`,
    `${WORKSPACE}/knowledge/${UPLOAD_ID}/nested/a.pdf`,
    `${WORKSPACE}/knowledge/${UPLOAD_ID}/a..pdf`,
    `${WORKSPACE}/knowledge/not-a-uuid/a.pdf`,
    `${WORKSPACE}/knowledge/${UPLOAD_ID}/`,
  ]) {
    assert.deepEqual(await rejection(formWithPath(path)), {
      status: 422,
      error: "VALIDATION_ERROR",
    });
  }
});

test("a file over the purpose's size limit is rejected", async () => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(15 * 1024 * 1024 + 1)], "big.pdf"));
  assert.deepEqual(await rejection(form), { status: 413, error: "FILE_TOO_LARGE" });
});
