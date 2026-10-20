export type ListKind = "todo" | "shopping";
export type TaskList = {
  id: string;
  title: string;
  kind: ListKind;
  created_at: string;
};
export type TaskItem = {
  id: string;
  list_id: string;
  text: string;
  completed: boolean;
  position: number;
  created_at: string;
};
export type ProposedItem = { text: string; completed: boolean };

// Reject malformed/truncated provider data rather than partially accepting a scan.
export function parseListResult(text: string): ProposedItem[] {
  const value: unknown = JSON.parse(text);
  if (
    !value ||
    typeof value !== "object" ||
    !("items" in value) ||
    !Array.isArray(value.items) ||
    value.items.length > 100
  )
    throw new Error("Invalid list response.");
  return value.items.map((item: unknown) => {
    if (
      !item ||
      typeof item !== "object" ||
      !("text" in item) ||
      typeof item.text !== "string" ||
      !item.text.trim() ||
      item.text.trim().length > 1000 ||
      !("completed" in item) ||
      typeof item.completed !== "boolean"
    )
      throw new Error("Invalid list item.");
    return { text: item.text.trim(), completed: item.completed };
  });
}
export function itemsInList(items: TaskItem[], listId: string): TaskItem[] {
  return items
    .filter((item) => item.list_id === listId)
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id),
    );
}
export function nextItemPosition(items: TaskItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.position + 1), 0);
}
