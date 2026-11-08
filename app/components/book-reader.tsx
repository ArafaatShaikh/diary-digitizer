"use client";
import { useState } from 'react';
type Page = { id: string; title: string; entry_date: string; corrected_transcription: string; page_number: number | null };
export default function BookReader({ pages, title, initialPage, onEdit }: { pages: Page[]; title: string; initialPage: string | null; onEdit: (page: Page) => void }) {
  const start = Math.max(0, pages.findIndex(p => p.id === initialPage));
  const [index, setIndex] = useState(start);
  const current = Math.min(index, Math.max(0,pages.length-1));
  const page = pages[current];
  if (!page) return null;
  const heading = /^page\s*\d+$/i.test(page.title.trim()) ? '' : page.title;
  return <section className="reading-room" aria-label="Book reader">
    <div className="book-cover-strip"><span className="eyebrow">YOUR PERSONAL EDITION</span><h2>{title}</h2><span className="book-flower" aria-hidden="true">✳</span></div>
    <article className="reading-leaf" tabIndex={-1} id={`page-${page.id}`} aria-label={heading || 'Diary writing'}>
      <div className="leaf-running-head" aria-hidden="true"><span>{title}</span><span>{page.entry_date}</span></div>
      {heading && <h2>{heading}</h2>}
      <div className="book-text">{page.corrected_transcription}</div>
      <div className="leaf-number" aria-hidden="true">{page.page_number || current+1}</div>
    </article>
    <nav className="book-turns" aria-label="Turn pages">
      <button className="secondary" disabled={current===0} onClick={()=>setIndex(current-1)}>← Previous</button>
      <span role="status">{current+1} / {pages.length}</span>
      <button className="secondary" disabled={current===pages.length-1} onClick={()=>setIndex(current+1)}>Next →</button>
    </nav>
    <button className="text-button book-edit" onClick={()=>onEdit(page)}>Edit this page</button>
  </section>;
}
