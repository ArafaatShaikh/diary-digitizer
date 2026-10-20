// RFC 5545: CRLF content lines, UTF-8 octet folding, escaped TEXT and UTC events.
// https://www.rfc-editor.org/rfc/rfc5545.html
export type StartOption = { value: string; offsetLabel: string };
export function calendarStartOptions(
  date: string,
  time: string,
): StartOption[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    throw new Error("Choose a valid date and time.");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (
    year < 1900 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  )
    throw new Error("Choose a valid date and time.");
  const wallTime = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wallTime);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  )
    throw new Error("Choose a valid date.");
  // Sample offsets either side of a clock change. Verify each against the exact
  // local fields, so missing times are rejected and repeated times need a choice.
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6)
    offsets.add(new Date(wallTime + hours * 3_600_000).getTimezoneOffset());
  const matches: StartOption[] = [];
  for (const offset of offsets) {
    const candidate = new Date(wallTime + offset * 60_000);
    if (
      candidate.getFullYear() !== year ||
      candidate.getMonth() !== month - 1 ||
      candidate.getDate() !== day ||
      candidate.getHours() !== hour ||
      candidate.getMinutes() !== minute
    )
      continue;
    const minutes = -offset;
    const offsetLabel = `UTC${minutes < 0 ? "-" : "+"}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}:${String(Math.abs(minutes) % 60).padStart(2, "0")}`;
    matches.push({ value: candidate.toISOString(), offsetLabel });
  }
  if (!matches.length)
    throw new Error(
      "This local time does not exist because the clocks change. Choose another time.",
    );
  return matches.sort((a, b) => a.value.localeCompare(b.value));
}
function escapeText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      parts.push(current);
      current = " ";
      bytes = 1;
    }
    current += character;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n");
}
function timestamp(date: Date): string {
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1900 ||
    date.getUTCFullYear() > 9999
  )
    throw new Error("Choose a supported event date.");
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
export function buildCalendarEvent({
  itemId,
  title,
  start,
  durationMinutes,
  reminderMinutes,
  description = "",
  location = "",
  now = new Date(),
  url,
}: {
  itemId: string;
  title: string;
  start: Date;
  durationMinutes: number;
  reminderMinutes: number | null;
  description?: string;
  location?: string;
  now?: Date;
  url?: string;
}): string {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(itemId))
    throw new Error("Invalid task identifier.");
  if (
    !title.trim() ||
    title.length > 1000 ||
    description.length > 250000 ||
    location.length > 500
  )
    throw new Error("Check the event title, notes, and location.");
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 1 ||
    durationMinutes > 1440
  )
    throw new Error("Choose a duration between 1 and 1,440 minutes.");
  if (
    reminderMinutes !== null &&
    (!Number.isInteger(reminderMinutes) ||
      reminderMinutes < 0 ||
      reminderMinutes > 43200)
  )
    throw new Error("Choose a valid alert time.");
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Paper kept close//Calendar export//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${itemId}-${start.getTime()}@paper-kept-close`,
    `DTSTAMP:${timestamp(now)}`,
    `DTSTART:${timestamp(start)}`,
    `DTEND:${timestamp(end)}`,
    `SUMMARY:${escapeText(title.trim())}`,
  ];
  if (url) {
    if (/[\r\n\u0000-\u0020]/.test(url) || url.length > 2048)
      throw new Error("Invalid calendar link.");
    const parsed = new URL(url);
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new Error("Invalid calendar link.");
    lines.push(`URL:${parsed.href}`);
  }
  if (description.trim())
    lines.push(`DESCRIPTION:${escapeText(description.trim())}`);
  if (location.trim()) lines.push(`LOCATION:${escapeText(location.trim())}`);
  if (reminderMinutes !== null)
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `TRIGGER:${reminderMinutes ? "-" : ""}PT${reminderMinutes}M`,
      `DESCRIPTION:${escapeText(title.trim())}`,
      "END:VALARM",
    );
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
