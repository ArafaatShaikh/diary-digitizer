import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFile } from "node:fs/promises";
// Compile the same production validator without an extra test-runtime dependency.
const source = await readFile(
  new URL("../lib/request-validation.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { validateImage, readJson, RequestError } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const jpeg = Buffer.from([255, 216, 255, 224]).toString("base64");
test("accepts JPEG bytes, rejects a mislabeled or invalid payload", () => {
  assert.equal(
    validateImage({ imageBase64: jpeg, mimeType: "image/jpeg" }).imageBase64,
    jpeg,
  );
  for (const body of [
    null,
    {},
    { imageBase64: jpeg, mimeType: "image/png" },
    { imageBase64: "evil", mimeType: "image/jpeg" },
    { imageBase64: "<script>", mimeType: "image/jpeg" },
  ])
    assert.throws(() => validateImage(body), RequestError);
});
test("rejects oversized images before decoding", () => {
  assert.throws(
    () =>
      validateImage({
        imageBase64: "A".repeat(3_000_004),
        mimeType: "image/jpeg",
      }),
    (e) => e.status === 413,
  );
});
test("limits actual streamed bytes even with no Content-Length", async () => {
  const request = new Request("http://test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"long":"value"}',
  });
  await assert.rejects(readJson(request, 4), (e) => e.status === 413);
});
test("rejects bad JSON and unsupported content types", async () => {
  await assert.rejects(
    readJson(new Request("http://test", { method: "POST", body: "{}" }), 50),
    (e) => e.status === 415,
  );
  await assert.rejects(
    readJson(
      new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
      50,
    ),
    (e) => e.status === 400,
  );
});
test("reads valid JSON", async () => {
  assert.deepEqual(
    await readJson(
      new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"ok":true}',
      }),
      50,
    ),
    { ok: true },
  );
});
