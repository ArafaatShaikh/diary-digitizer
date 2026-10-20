/** Sequential scans stop on the first failure; already read or typed pages are skipped. */
export async function readPendingPages<
  T extends { raw: string; text: string; saved: boolean },
>(pages: T[], read: (page: T) => Promise<void>) {
  for (const page of pages) {
    if (!page.saved && !page.raw && !page.text) await read(page);
  }
}
export function validPageRange(first: number, count: number) {
  return (
    Number.isSafeInteger(first) &&
    first >= 1 &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= 10 &&
    first + count - 1 <= 2147483647
  );
}
