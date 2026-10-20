import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../lib/calendar.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { buildCalendarEvent, calendarStartOptions } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
function inZone(zone, fn) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}
const base = {
  itemId: "00000000-0000-0000-0000-000000000001",
  title: "Call dentist",
  start: new Date("2027-05-01T09:00:00Z"),
  durationMinutes: 30,
  reminderMinutes: 15,
  now: new Date("2026-10-21T10:00:00Z"),
};
const unfold = (value) => value.replace(/\r\n[ \t]/g, "");
test("exports a UTC event with elapsed duration, stable identity, and the chosen calendar alert", () => {
  const file = buildCalendarEvent(base);
  assert.ok(
    file.includes("DTSTART:20270501T090000Z\r\nDTEND:20270501T093000Z"),
  );
  assert.ok(file.includes("DTSTAMP:20261021T100000Z"));
  assert.ok(file.includes("TRIGGER:-PT15M"));
  assert.ok(file.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!/[^\r]\n/.test(file));
  const next = buildCalendarEvent({
    ...base,
    now: new Date("2026-10-22T00:00:00Z"),
  });
  assert.equal(file.match(/^UID:(.+)$/m)[1], next.match(/^UID:(.+)$/m)[1]);
  assert.ok(
    buildCalendarEvent({ ...base, reminderMinutes: 0 }).includes(
      "TRIGGER:PT0M",
    ),
  );
  assert.ok(
    !buildCalendarEvent({ ...base, reminderMinutes: null }).includes("VALARM"),
  );
});
test("escapes text and prevents extra events/properties from user-controlled text", () => {
  const file = unfold(
    buildCalendarEvent({
      ...base,
      title: "Milk, bread; path\\file\r\nEND:VEVENT\r\nBEGIN:VEVENT",
      description: "First\nSecond",
      location: "Room 1, left; side",
    }),
  );
  assert.equal(
    file.split("\r\n").filter((line) => line === "BEGIN:VEVENT").length,
    1,
  );
  assert.equal(
    file.split("\r\n").filter((line) => line === "END:VEVENT").length,
    1,
  );
  assert.ok(
    file.includes(
      "SUMMARY:Milk\\, bread\\; path\\\\file\\nEND:VEVENT\\nBEGIN:VEVENT",
    ),
  );
  assert.ok(file.includes("DESCRIPTION:First\\nSecond"));
  assert.ok(file.includes("LOCATION:Room 1\\, left\\; side"));
});
test("folds long UTF-8 text at character boundaries within 75 octets", () => {
  const title = "বাংলা লেখা 🌻 ".repeat(40);
  const file = buildCalendarEvent({ ...base, title });
  for (const line of file.split("\r\n"))
    assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.ok(unfold(file).includes(`SUMMARY:${title.trim()}`));
  assert.ok(!file.includes("\uFFFD"));
});
test("London clock changes reject missing times and expose both repeated occurrences", () =>
  inZone("Europe/London", () => {
    assert.throws(
      () => calendarStartOptions("2027-03-28", "01:30"),
      /does not exist/,
    );
    const options = calendarStartOptions("2027-10-31", "01:30");
    assert.deepEqual(
      options.map((option) => option.value),
      ["2027-10-31T00:30:00.000Z", "2027-10-31T01:30:00.000Z"],
    );
    assert.deepEqual(
      options.map((option) => option.offsetLabel),
      ["UTC+01:00", "UTC+00:00"],
    );
    const file = buildCalendarEvent({
      ...base,
      start: new Date("2027-10-31T00:45:00Z"),
    });
    assert.ok(file.includes("DTEND:20271031T011500Z"));
  }));
test("supports half-hour offsets and half-hour clock changes", () => {
  inZone("Asia/Kolkata", () =>
    assert.deepEqual(calendarStartOptions("2027-05-01", "10:00"), [
      { value: "2027-05-01T04:30:00.000Z", offsetLabel: "UTC+05:30" },
    ]),
  );
  inZone("Australia/Lord_Howe", () => {
    assert.throws(
      () => calendarStartOptions("2027-10-03", "02:15"),
      /does not exist/,
    );
    assert.equal(calendarStartOptions("2027-04-04", "01:45").length, 2);
  });
  inZone("America/New_York", () =>
    assert.deepEqual(
      calendarStartOptions("2027-11-07", "01:30").map((option) => option.value),
      ["2027-11-07T05:30:00.000Z", "2027-11-07T06:30:00.000Z"],
    ),
  );
});
test("invalid dates, times, durations, identifiers, and alerts do not produce files", () => {
  inZone("UTC", () => {
    for (const [date, time] of [
      ["2027-02-30", "10:00"],
      ["2027-01-01", "24:00"],
      ["2027-01-01", "09:60"],
      ["wrong", "10:00"],
    ])
      assert.throws(() => calendarStartOptions(date, time));
  });
  for (const change of [
    { title: " " },
    { durationMinutes: 0 },
    { durationMinutes: 1.5 },
    { durationMinutes: 1441 },
    { reminderMinutes: -1 },
    { reminderMinutes: NaN },
    { start: new Date("bad") },
    { itemId: "id\nBEGIN:VEVENT" },
  ])
    assert.throws(() => buildCalendarEvent({ ...base, ...change }));
});
