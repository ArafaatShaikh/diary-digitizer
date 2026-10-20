export type Diary = {
  id: string;
  title: string;
  description: string;
  cover_path: string | null;
  created_at: string;
};
export type OrderedPage = {
  id: string;
  diary_id: string | null;
  page_number: number | null;
};
export function pagesInDiary<T extends OrderedPage>(
  pages: T[],
  diaryId: string | null,
): T[] {
  return pages
    .filter((page) => (page.diary_id ?? null) === diaryId)
    .sort(
      (a, b) =>
        (a.page_number ?? Number.MAX_SAFE_INTEGER) -
          (b.page_number ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id),
    );
}
export function nextPageNumber(
  pages: OrderedPage[],
  diaryId: string | null,
): number {
  return (
    Math.max(
      0,
      ...pages
        .filter((page) => (page.diary_id ?? null) === diaryId)
        .map((page) => page.page_number || 0),
    ) + 1
  );
}
