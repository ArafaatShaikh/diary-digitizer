import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../lib/list-calendar.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { requestedListId, listAppUrl, listCalendarDescription } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const id = "01234567-89ab-cdef-0123-456789abcdef";
const appUrl = `https://example.com/?list=${id}`;
const items = [
  { text: "দুধ ২ লিটার", completed: false },
  { text: "Tomatoes", completed: true },
  { text: "Milk", completed: false },
];
test("a list link contains only the app origin and validated list identifier", () => {
  assert.equal(
    listAppUrl("https://example.com/old?token=secret#old", id),
    appUrl,
  );
  assert.equal(requestedListId(`?list=${id.toUpperCase()}`), id);
  assert.equal(requestedListId("?list=<script>"), null);
  assert.equal(requestedListId(""), null);
  assert.throws(() => listAppUrl("javascript:alert(1)", id));
  assert.throws(() => listAppUrl("https://example.com", "../other"));
});
test("whole-list contents include every supplied item and its completion state", () => {
  const description = listCalendarDescription({
    title: "Shopping",
    items,
    mode: "contents",
    appUrl,
  });
  assert.ok(description.includes("[ ] দুধ ২ লিটার\n[x] Tomatoes\n[ ] Milk"));
  assert.ok(!description.includes(appUrl));
  assert.ok(description.includes("snapshot at export"));
});
test("the user can select link only, contents only, or both", () => {
  const link = listCalendarDescription({
    title: "Shopping",
    items,
    mode: "link",
    appUrl,
  });
  assert.ok(link.includes(appUrl));
  assert.ok(link.includes("sign-in required"));
  assert.ok(!link.includes("Tomatoes"));
  const both = listCalendarDescription({
    title: "Shopping",
    items,
    mode: "both",
    appUrl,
    notes: "Bring bags",
  });
  assert.ok(both.includes(appUrl));
  assert.ok(both.includes("Tomatoes"));
  assert.ok(both.endsWith("Bring bags"));
  assert.throws(() =>
    listCalendarDescription({
      title: "Shopping",
      items,
      mode: "invalid",
      appUrl,
    }),
  );
});
test("empty lists remain valid and no long list is silently truncated", () => {
  assert.ok(
    listCalendarDescription({
      title: "Empty",
      items: [],
      mode: "contents",
      appUrl,
    }).includes("(Empty list)"),
  );
  const large = Array.from({ length: 200 }, (_, i) => ({
    text: `Item ${i}: ${"a".repeat(50)}`,
    completed: false,
  }));
  const description = listCalendarDescription({
    title: "Large",
    items: large,
    mode: "contents",
    appUrl,
  });
  assert.ok(description.length > 5000);
  assert.ok(description.includes("Item 199:"));
});
