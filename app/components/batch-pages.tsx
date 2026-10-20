"use client";
/* eslint-disable @next/next/no-img-element -- Local photo previews. */
import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { preparePhoto } from "@/lib/photo";
import { readPendingPages, validPageRange } from "@/lib/batch-pages";

type Draft = {
  id: string;
  name: string;
  image: string;
  raw: string;
  text: string;
  title: string;
  reviewed: boolean;
  saved: boolean;
  path: string | null;
};
export default function BatchPages({
  session,
  diaryId,
  startPage,
  onBusy,
  onSaved,
  onClose,
}: {
  session: Session;
  diaryId: string | null;
  startPage: number;
  onBusy: (busy: boolean) => void;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [first, setFirst] = useState(startPage);
  const [date, setDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [locked, setLocked] = useState(false);
  function working(value: boolean) {
    setBusy(value);
    onBusy(value);
  }
  function update(id: string, patch: Partial<Draft>) {
    setDrafts((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }
  async function choose(files: File[]) {
    if (files.length + drafts.length > 10) {
      setStatus("Choose up to 10 photos per batch.");
      return;
    }
    working(true);
    try {
      for (const file of files) {
        setStatus(`Preparing ${file.name}…`);
        const image = await preparePhoto(file);
        setDrafts((items) => [
          ...items,
          {
            id: crypto.randomUUID(),
            name: file.name,
            image,
            raw: "",
            text: "",
            title: "",
            reviewed: false,
            saved: false,
            path: null,
          },
        ]);
      }
      setStatus(
        "Check the order and starting page number, then read the handwriting. Each photo uses one scan from your allowance.",
      );
    } catch (error) {
      setStatus(String(error));
    } finally {
      working(false);
    }
  }
  async function read() {
    working(true);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session)
        throw new Error("Sign in again to scan these pages.");
      await readPendingPages(drafts, async (draft) => {
        setStatus(`Reading ${draft.name}…`);
        const response = await fetch("/api/transcribe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${data.session.access_token}`,
          },
          body: JSON.stringify({
            imageBase64: draft.image.split(",")[1],
            mimeType: "image/jpeg",
          }),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Could not read this photo.");
        if (typeof result.text !== "string" || !result.text.trim())
          throw new Error(
            "No text returned. Retry or enter the text yourself.",
          );
        update(draft.id, {
          raw: result.text,
          text: result.text,
          reviewed: false,
        });
      });
      setStatus("Review each page and tick its confirmation before saving.");
    } catch (error) {
      setStatus(
        `${String(error)} Completed transcriptions are kept. Retry to continue with unread photos.`,
      );
    } finally {
      working(false);
    }
  }
  async function save() {
    if (!validPageRange(first, drafts.length) || !date) {
      setStatus("Enter a valid starting page number and date.");
      return;
    }
    const pending = drafts.filter((d) => !d.saved);
    if (!pending.length || pending.some((d) => !d.reviewed || !d.text.trim()))
      return;
    working(true);
    setLocked(true);
    try {
      for (const [index, draft] of drafts.entries()) {
        if (draft.saved) continue;
        setStatus(`Saving page ${first + index}…`);
        let path = draft.path;
        if (!path) {
          // A unique upload path lets retries proceed even after an uncertain upload response.
          path = `${session.user.id}/${draft.id}-${crypto.randomUUID()}.jpg`;
          const blob = await (await fetch(draft.image)).blob();
          const { error } = await supabase.storage
            .from("diary-pages")
            .upload(path, blob, { contentType: "image/jpeg", upsert: false });
          if (error) throw error;
          update(draft.id, { path });
        }
        // Stable row IDs make a retry safe if the previous response was lost.
        const { error } = await supabase.from("entries").upsert(
          {
            id: draft.id,
            user_id: session.user.id,
            diary_id: diaryId,
            title: draft.title.trim() || `Page ${first + index}`,
            kind: "journal",
            entry_date: date,
            page_number: first + index,
            image_path: path,
            image_url: "",
            raw_transcription: draft.raw,
            corrected_transcription: draft.text,
          },
          { onConflict: "id" },
        );
        if (error) throw error;
        update(draft.id, { saved: true });
        onSaved();
      }
      setStatus("All pages saved. Return to your diary to read them.");
    } catch (error) {
      setStatus(
        `${String(error)} Saved pages are marked below. Retry saves only the remaining pages. Keep this screen open to retain drafts.`,
      );
    } finally {
      working(false);
    }
  }
  return (
    <section className="panel stack">
      <div className="row spread">
        <h2>Add multiple pages</h2>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            if (
              drafts.some((d) => !d.saved) &&
              !confirm(
                "Discard unsaved pages? Uploaded photos for unsaved pages will be removed.",
              )
            )
              return;
            void (async () => {
              working(true);
              const pending = drafts.filter((d) => !d.saved && d.path);
              let paths: string[] = [];
              if (pending.length) {
                const { data, error } = await supabase
                  .from("entries")
                  .select("id,image_path")
                  .in(
                    "id",
                    pending.map((d) => d.id),
                  )
                  .eq("user_id", session.user.id);
                if (error) {
                  setStatus(
                    "Could not verify saved pages. Keep this tab open and retry closing.",
                  );
                  working(false);
                  return;
                }
                paths = pending
                  .filter((d) => !data.some((row) => row.image_path === d.path))
                  .map((d) => d.path!);
              }
              if (paths.length) {
                const { error } = await supabase.storage
                  .from("diary-pages")
                  .remove(paths);
                if (error) {
                  setStatus(
                    `Could not clean up uploaded photos: ${error.message}. Retry closing.`,
                  );
                  working(false);
                  return;
                }
              }
              working(false);
              onClose();
            })();
          }}
        >
          Back to diary
        </button>
      </div>
      <p>
        One photo per page. Reorder photos before saving. Drafts stay in this
        tab until you leave or reload.
      </p>
      <div className="field-grid">
        <label>
          Starting page number
          <input
            type="number"
            min="1"
            step="1"
            disabled={busy || locked}
            value={first}
            onChange={(e) => setFirst(Number(e.target.value))}
          />
        </label>
        <label>
          Written on
          <input
            type="date"
            required
            disabled={busy || locked}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>
      <label className="upload-button">
        Choose photos (up to 10)
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={busy || locked || drafts.length >= 10}
          onChange={(e) => {
            void choose(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
      </label>
      {status && (
        <p className="notice" role="status">
          {status}
        </p>
      )}
      {drafts.length > 0 && (
        <button
          disabled={busy || !drafts.some((d) => !d.saved && !d.raw && !d.text)}
          onClick={read}
        >
          Read unread photos
        </button>
      )}
      {drafts.map((draft, index) => (
        <article className="batch-page stack" key={draft.id}>
          <div className="row spread">
            <h3>
              Page {first + index}
              {draft.saved ? " · Saved" : ""}
            </h3>
            <div className="row">
              {[-1, 1].map((direction) => (
                <button
                  key={direction}
                  className="secondary"
                  aria-label={`Move page ${first + index} ${direction < 0 ? "up" : "down"}`}
                  disabled={
                    busy ||
                    locked ||
                    index + direction < 0 ||
                    index + direction >= drafts.length
                  }
                  onClick={() =>
                    setDrafts((items) => {
                      const next = [...items];
                      [next[index], next[index + direction]] = [
                        next[index + direction],
                        next[index],
                      ];
                      return next;
                    })
                  }
                >
                  {direction < 0 ? "↑" : "↓"}
                </button>
              ))}
              <button
                className="secondary"
                disabled={busy || locked}
                onClick={() =>
                  setDrafts((items) => items.filter((d) => d.id !== draft.id))
                }
              >
                Remove
              </button>
            </div>
          </div>
          <div className="editor-grid">
            <img
              className="page-photo"
              src={draft.image}
              alt={`Page ${first + index}: ${draft.name}`}
            />
            <div className="stack">
              <label>
                Title
                <input
                  maxLength={160}
                  disabled={busy || draft.saved}
                  value={draft.title}
                  onChange={(e) => update(draft.id, { title: e.target.value })}
                />
              </label>
              <label>
                Review text
                <textarea
                  rows={12}
                  disabled={busy || draft.saved}
                  value={draft.text}
                  onChange={(e) =>
                    update(draft.id, { text: e.target.value, reviewed: false })
                  }
                />
              </label>
              <label className="row">
                <input
                  type="checkbox"
                  disabled={busy || draft.saved || !draft.text.trim()}
                  checked={draft.reviewed}
                  onChange={(e) =>
                    update(draft.id, { reviewed: e.target.checked })
                  }
                />
                I have checked this page
              </label>
            </div>
          </div>
        </article>
      ))}
      {drafts.length > 0 && (
        <button
          disabled={
            busy ||
            !drafts.some((d) => !d.saved) ||
            drafts.some((d) => !d.saved && (!d.reviewed || !d.text.trim()))
          }
          onClick={save}
        >
          {busy ? "Please wait…" : "Save reviewed pages"}
        </button>
      )}
    </section>
  );
}
