import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../lib/batch-pages.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { readPendingPages, validPageRange } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
test("batch scans stop on failure and resume without rereading successful or typed pages", async () => {
  const pages = Array.from({ length: 5 }, (_, id) => ({
    id,
    raw: "",
    text: "",
    saved: false,
  }));
  pages[0].saved = true;
  pages[1].text = "Typed by hand";
  const calls = [];
  await assert.rejects(
    readPendingPages(pages, async (page) => {
      calls.push(page.id);
      if (page.id === 3) throw Error("quota");
      page.raw = "read";
      page.text = "read";
    }),
    /quota/,
  );
  assert.deepEqual(calls, [2, 3]);
  await readPendingPages(pages, async (page) => {
    calls.push(page.id);
    page.raw = "read";
  });
  assert.deepEqual(calls, [2, 3, 3, 4]);
});
test("batch numbering fits database integer limits and the ten photo cap", () => {
  assert.equal(validPageRange(1, 10), true);
  for (const [first, count] of [
    [0, 2],
    [1.5, 2],
    [1, 0],
    [1, 11],
    [2147483647, 2],
    [NaN, 1],
  ])
    assert.equal(validPageRange(first, count), false);
});
