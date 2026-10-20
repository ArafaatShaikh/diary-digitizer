import type { ProposedItem } from "./list-data";
export type CalendarContents = "link" | "contents" | "both";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function requestedListId(search: string): string | null {
  const id = new URLSearchParams(search).get("list");
  return id && uuid.test(id) ? id.toLowerCase() : null;
}
export function listAppUrl(origin: string, listId: string): string {
  if (!uuid.test(listId)) throw new Error("Invalid list identifier.");
  const url = new URL("/", origin);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Invalid app address.");
  url.searchParams.set("list", listId.toLowerCase());
  return url.href;
}
export function listCalendarDescription({
  title,
  items,
  mode,
  appUrl,
  notes = "",
}: {
  title: string;
  items: ProposedItem[];
  mode: CalendarContents;
  appUrl: string;
  notes?: string;
}): string {
  if (!["link", "contents", "both"].includes(mode))
    throw new Error("Choose what to include in the event.");
  const sections = [`List: ${title}`];
  if (mode !== "link")
    sections.push(
      `List contents (snapshot at export):\n${items.length ? items.map((item) => `${item.completed ? "[x]" : "[ ]"} ${item.text}`).join("\n") : "(Empty list)"}`,
    );
  if (mode !== "contents")
    sections.push(`Open the current list (sign-in required):\n${appUrl}`);
  if (notes.trim()) sections.push(notes.trim());
  return sections.join("\n\n");
}
