import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../lib/diaries.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { pagesInDiary, nextPageNumber } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const pages = [
  { id: "a", diary_id: "first", page_number: 4 },
  { id: "b", diary_id: "second", page_number: 20 },
  { id: "c", diary_id: "first", page_number: 1 },
  { id: "d", diary_id: null, page_number: 50 },
  { id: "e", diary_id: "first", page_number: null },
];
test("page numbering belongs to a diary and uses the highest page, not the count", () => {
  assert.equal(nextPageNumber(pages, "first"), 5);
  assert.equal(nextPageNumber(pages, "second"), 21);
  assert.equal(nextPageNumber(pages, "empty"), 1);
  assert.equal(nextPageNumber(pages, null), 51);
});
test("reading and exports contain only the selected diary, in page order", () => {
  assert.deepEqual(
    pagesInDiary(pages, "first").map((page) => page.id),
    ["c", "a", "e"],
  );
  assert.deepEqual(
    pagesInDiary(pages, null).map((page) => page.id),
    ["d"],
  );
  assert.deepEqual(
    pages.map((page) => page.id),
    ["a", "b", "c", "d", "e"],
  );
});
