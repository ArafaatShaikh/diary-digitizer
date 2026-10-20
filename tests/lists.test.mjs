import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../lib/list-data.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { parseListResult, itemsInList, nextItemPosition } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
test("scanned items preserve quantities, scripts, dates as text, and explicit checkbox states", () => {
  assert.deepEqual(
    parseListResult(
      JSON.stringify({
        items: [
          { text: " দুধ ২ লিটার ", completed: false },
          { text: "Call dentist Friday 2pm", completed: true },
        ],
      }),
    ),
    [
      { text: "দুধ ২ লিটার", completed: false },
      { text: "Call dentist Friday 2pm", completed: true },
    ],
  );
});
test("invalid or partially malformed scans are rejected as a whole", () => {
  for (const text of [
    "{",
    "null",
    "{}",
    '{"items":"Milk"}',
    JSON.stringify({
      items: [
        { text: "Milk", completed: false },
        { text: "", completed: true },
      ],
    }),
    JSON.stringify({ items: [{ text: "Milk", completed: "false" }] }),
    JSON.stringify({ items: [{ text: "a".repeat(1001), completed: false }] }),
    JSON.stringify({
      items: Array.from({ length: 101 }, () => ({
        text: "Milk",
        completed: false,
      })),
    }),
  ])
    assert.throws(() => parseListResult(text));
});
test("list ordering and new positions do not mix lists or lose gaps", () => {
  const items = [
    {
      id: "a",
      list_id: "one",
      position: 5,
      created_at: "2026-10-21",
      text: "a",
      completed: true,
    },
    {
      id: "b",
      list_id: "two",
      position: 99,
      created_at: "2026-10-20",
      text: "b",
      completed: false,
    },
    {
      id: "c",
      list_id: "one",
      position: 0,
      created_at: "2026-10-20",
      text: "c",
      completed: false,
    },
  ];
  const selected = itemsInList(items, "one");
  assert.deepEqual(
    selected.map((item) => item.id),
    ["c", "a"],
  );
  assert.equal(nextItemPosition(selected), 6);
  assert.equal(nextItemPosition([]), 0);
  assert.deepEqual(
    items.map((item) => item.id),
    ["a", "b", "c"],
  );
});
