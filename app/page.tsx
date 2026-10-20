"use client";
/* eslint-disable @next/next/no-img-element -- Private signed URLs and local photo previews must not use a shared image optimizer. */

import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  BookOpen,
  Camera,
  LogOut,
  Search,
  Plus,
  Download,
  Trash2,
  ArrowLeft,
} from "lucide-react";
import { isConfigured, supabase } from "@/lib/supabase";
import { preparePhoto } from "@/lib/photo";
import Lists from "./components/lists";
import { pagesInDiary, nextPageNumber, type Diary } from "@/lib/diaries";

type Kind = "journal" | "note" | "letter" | "list";
const kinds: { value: Kind; label: string }[] = [
  { value: "journal", label: "Journal" },
  { value: "note", label: "Notes" },
  { value: "letter", label: "Letter" },
  { value: "list", label: "List (text page)" },
];
type Entry = {
  diary_id: string | null;
  id: string;
  title: string;
  kind: Kind;
  entry_date: string;
  page_number: number | null;
  image_path: string | null;
  image_url: string;
  raw_transcription: string;
  corrected_transcription: string;
  created_at: string;
};
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something failed. Please try again.";
}
function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState("");
  useEffect(() => {
    if (!isConfigured) return;
    let active = true;
    // Remove the old shared-passcode flag. It never represented a server session.
    localStorage.removeItem("diary_authenticated");
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) {
        setSession(next);
        setReady(true);
      }
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (active) {
        if (error) setAuthError(error.message);
        setSession(data.session);
        setReady(true);
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  if (!isConfigured)
    return (
      <main className="auth">
        <BookOpen size={36} />
        <h1>Connect your journal</h1>
        <p>
          Add the public Supabase URL and anon key to Vercel, then redeploy. See
          the repository README for setup.
        </p>
      </main>
    );
  if (!ready)
    return (
      <main className="auth">
        <p role="status">Opening your journal…</p>
      </main>
    );
  if (!session) return <SignIn initialError={authError} />;
  return <Workspace key={session.user.id} session={session} />;
}

function SignIn({ initialError }: { initialError: string }) {
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(initialError);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${location.origin}/reset-password`,
        });
        if (error) throw error;
        setStatus(
          "If this email has an account, a password reset link is on its way.",
        );
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: location.origin },
        });
        if (error) throw error;
        if (!data.session)
          setStatus("Check your email to confirm your account, then sign in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth">
      <div className="brand-mark">
        <BookOpen size={30} />
      </div>
      <p className="eyebrow">Paper, kept close</p>
      <h1>
        Your words,
        <br />a little easier to find.
      </h1>
      <p>
        Keep writing by hand. Save your pages in your own searchable journal.
      </p>
      <form onSubmit={submit} className="stack">
        <h2>
          {mode === "signup"
            ? "Create your account"
            : mode === "reset"
              ? "Reset your password"
              : "Welcome back"}
        </h2>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </label>
        {mode !== "reset" && (
          <label>
            Password
            <input
              type="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
        {status && (
          <p className="notice" role="status">
            {status}
          </p>
        )}
        <button disabled={busy}>
          {busy
            ? "Please wait…"
            : mode === "signup"
              ? "Create account"
              : mode === "reset"
                ? "Send reset link"
                : "Sign in"}
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            setMode(mode === "signup" ? "signin" : "signup");
            setStatus("");
          }}
        >
          {mode === "signup"
            ? "Already have an account? Sign in"
            : "New here? Create an account"}
        </button>
        {mode === "signin" && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              setMode("reset");
              setStatus("");
            }}
          >
            Forgot password?
          </button>
        )}
        {mode === "reset" && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => setMode("signin")}
          >
            Back to sign in
          </button>
        )}
      </form>
      <p className="small">
        On iPhone: Share → Add to Home Screen. An internet connection is
        required.
      </p>
    </main>
  );
}

function PagePhoto({ entry }: { entry: Entry }) {
  const [src, setSrc] = useState(
    entry.image_url?.startsWith("data:image/") ? entry.image_url : "",
  );
  const [failed, setFailed] = useState(
    !entry.image_path && !entry.image_url?.startsWith("data:image/"),
  );
  useEffect(() => {
    let active = true;
    if (entry.image_path) {
      void supabase.storage
        .from("diary-pages")
        .createSignedUrl(entry.image_path, 3600)
        .then(({ data, error }) => {
          if (active) {
            setSrc(data?.signedUrl || "");
            setFailed(Boolean(error));
          }
        });
    }
    // Legacy public URLs are not fetched automatically; see the migration guide.
    return () => {
      active = false;
    };
  }, [entry.id, entry.image_path, entry.image_url]);
  return src ? (
    <img
      className="page-photo"
      src={src}
      alt="Original handwritten page"
      onError={() => {
        setSrc("");
        setFailed(true);
      }}
    />
  ) : (
    <p className="small">
      {failed
        ? "Original photo unavailable. Your saved text is still here."
        : "Loading original photo…"}
    </p>
  );
}

function DiaryCover({ diary }: { diary: Diary }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let active = true;
    if (diary.cover_path) {
      void supabase.storage
        .from("diary-covers")
        .createSignedUrl(diary.cover_path, 3600)
        .then(({ data }) => {
          if (active) setSrc(data?.signedUrl || "");
        });
    }
    return () => {
      active = false;
    };
  }, [diary.cover_path]);
  return src ? (
    <img
      className="diary-cover"
      src={src}
      alt={`Cover for ${diary.title}`}
      loading="lazy"
      onError={() => setSrc("")}
    />
  ) : (
    <div className="diary-cover-placeholder" aria-hidden="true">
      <BookOpen size={36} />
    </div>
  );
}

function Workspace({ session }: { session: Session }) {
  const [area, setArea] = useState<"diaries" | "lists">("diaries");
  const [listDirty, setListDirty] = useState(false);
  const [listBusy, setListBusy] = useState(false);
  const [accountStatus, setAccountStatus] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [diaries, setDiaries] = useState<Diary[]>([]);
  // null = diary shelf; "loose" = pages not assigned to a diary.
  const [activeDiaryId, setActiveDiaryId] = useState<string | null>(null);
  const [diaryId, setDiaryId] = useState("");
  const [diaryForm, setDiaryForm] = useState(false);
  const [editingDiary, setEditingDiary] = useState<Diary | null>(null);
  const [diaryTitle, setDiaryTitle] = useState("");
  const [diaryDescription, setDiaryDescription] = useState("");
  const [view, setView] = useState<"pages" | "index" | "book">("pages");
  const [jumpPage, setJumpPage] = useState<string | null>(null);
  const [coverPhoto, setCoverPhoto] = useState("");
  const [removeCover, setRemoveCover] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [editor, setEditor] = useState(false);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [photo, setPhoto] = useState("");
  const [raw, setRaw] = useState("");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Kind>("journal");
  const [date, setDate] = useState(localDate());
  const [page, setPage] = useState(1);
  const [vocabulary, setVocabulary] = useState("");
  const [preferences, setPreferences] = useState(false);
  useEffect(() => {
    let active = true;
    async function loadEntries() {
      const pages: Entry[] = [];
      try {
        const books: Diary[] = [];
        for (let offset = 0; active; offset += 200) {
          const { data, error } = await supabase
            .from("diaries")
            .select("id,title,description,cover_path,created_at")
            .eq("user_id", session.user.id)
            .order("created_at", { ascending: false })
            .order("id")
            .range(offset, offset + 199);
          if (error) throw error;
          books.push(...(data || []));
          if (!data || data.length < 200) break;
        }
        for (let offset = 0; active; offset += 200) {
          const { data, error } = await supabase
            .from("entries")
            .select("*")
            .eq("user_id", session.user.id)
            .order("entry_date", { ascending: false })
            .order("page_number", { ascending: true })
            .order("id", { ascending: true })
            .range(offset, offset + 199);
          if (error) throw error;
          pages.push(...(data || []));
          if (!data || data.length < 200) break;
        }
        if (active) {
          setEntries(pages);
          setDiaries(books);
          setLoaded(true);
        }
      } catch (error) {
        if (active) {
          setStatus(`Could not load your pages: ${message(error)}`);
          setLoaded(false);
        }
      }
    }
    void loadEntries();
    return () => {
      active = false;
    };
  }, [session.user.id, revision]);
  useEffect(() => {
    let active = true;
    void supabase
      .from("profiles")
      .select("personal_lexicon")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error)
          setStatus(`Could not load your vocabulary: ${error.message}`);
        else setVocabulary((data?.personal_lexicon || []).join("\n"));
      });
    return () => {
      active = false;
    };
  }, [session.user.id]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (editor) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editor]);
  const currentDiary = diaries.find((diary) => diary.id === activeDiaryId);
  const scopedPages = pagesInDiary(entries, currentDiary?.id || null);
  const loosePages = pagesInDiary(entries, null);
  useEffect(() => {
    if (view === "book" && jumpPage) {
      const target = document.getElementById(`page-${jumpPage}`);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      target?.focus({ preventScroll: true });
    }
  }, [view, jumpPage]);
  function enterDiary(id: string | null) {
    setActiveDiaryId(id);
    setQuery("");
    setFilter("all");
    setView("pages");
    setJumpPage(null);
    setDiaryForm(false);
    setStatus("");
  }
  function newDiary(diary: Diary | null = null) {
    setEditingDiary(diary);
    setDiaryTitle(diary?.title || "");
    setCoverPhoto("");
    setRemoveCover(false);
    setDiaryDescription(diary?.description || "");
    setDiaryForm(true);
    setStatus("");
  }
  async function chooseCover(file?: File) {
    if (!file) return;
    setBusy(true);
    setStatus("");
    try {
      setCoverPhoto(
        await preparePhoto(file, {
          maxDimension: 1200,
          maxBase64Length: 1_000_000,
        }),
      );
      setRemoveCover(false);
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function saveDiary(event: FormEvent) {
    event.preventDefault();
    if (!diaryTitle.trim()) return;
    setBusy(true);
    let uploaded: string | null = null;
    let committed = false;
    try {
      const id = editingDiary?.id || crypto.randomUUID();
      const oldCover = editingDiary?.cover_path || null;
      let coverPath = removeCover ? null : oldCover;
      if (coverPhoto) {
        coverPath = `${session.user.id}/${id}/${crypto.randomUUID()}.jpg`;
        const blob = await (await fetch(coverPhoto)).blob();
        const { error } = await supabase.storage
          .from("diary-covers")
          .upload(coverPath, blob, {
            contentType: "image/jpeg",
            upsert: false,
          });
        if (error) throw error;
        uploaded = coverPath;
      }
      const record = {
        title: diaryTitle.trim(),
        description: diaryDescription.trim(),
        cover_path: coverPath,
      };
      const result = editingDiary
        ? await supabase
            .from("diaries")
            .update(record)
            .eq("id", id)
            .eq("user_id", session.user.id)
            .select("id,title,description,cover_path,created_at")
            .single()
        : await supabase
            .from("diaries")
            .insert({ ...record, id, user_id: session.user.id })
            .select("id,title,description,cover_path,created_at")
            .single();
      if (result.error) throw result.error;
      committed = true;
      setDiaries((old) =>
        editingDiary
          ? old.map((diary) =>
              diary.id === result.data.id ? result.data : diary,
            )
          : [result.data, ...old],
      );
      setDiaryForm(false);
      setCoverPhoto("");
      enterDiary(result.data.id);
      setStatus(
        editingDiary ? "Diary updated." : "Diary created. Add its first page.",
      );
      if (oldCover && oldCover !== coverPath) {
        const { error } = await supabase.storage
          .from("diary-covers")
          .remove([oldCover]);
        if (error)
          setStatus(
            "Diary saved, but the old cover could not be removed from storage. Ask the project owner to clean it up.",
          );
      }
    } catch (error) {
      let cleanupFailed = false;
      if (!committed && uploaded) {
        const { error: cleanupError } = await supabase.storage
          .from("diary-covers")
          .remove([uploaded]);
        cleanupFailed = Boolean(cleanupError);
      }
      setStatus(
        committed
          ? "Diary saved, but cover cleanup failed."
          : `Could not save diary: ${message(error)}${cleanupFailed ? " Cover cleanup also failed." : ""}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function deleteEmptyDiary(diary: Diary) {
    if (!confirm(`Delete the empty diary “${diary.title}”?`)) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("diaries")
        .delete()
        .eq("id", diary.id)
        .eq("user_id", session.user.id)
        .select("id")
        .single();
      if (error) throw error;
      setDiaries((old) => old.filter((book) => book.id !== diary.id));
      enterDiary(null);
      setStatus("Empty diary deleted.");
      if (diary.cover_path) {
        const { error } = await supabase.storage
          .from("diary-covers")
          .remove([diary.cover_path]);
        if (error)
          setStatus(
            "Diary deleted, but its cover could not be removed from storage. Ask the project owner to clean it up.",
          );
      }
    } catch {
      setStatus(
        "Could not delete this diary. If it contains pages, move them first and reload.",
      );
    } finally {
      setBusy(false);
    }
  }
  function open(entry: Entry | null) {
    if (editor && !confirm("Discard the current draft?")) return;
    setSelected(entry);
    setPhoto("");
    setRaw(entry?.raw_transcription || "");
    setText(entry?.corrected_transcription || "");
    setTitle(entry?.title || "");
    setKind(entry?.kind || "journal");
    setDate(entry?.entry_date || localDate());
    const target = entry ? entry.diary_id || "" : currentDiary?.id || "";
    setDiaryId(target);
    setPage(entry?.page_number || nextPageNumber(entries, target || null));
    setEditor(true);
    setStatus("");
  }
  async function scan(file?: File) {
    if (!file) return;
    if ((text || photo) && !confirm("Replace the current photo and text?"))
      return;
    setBusy(true);
    setStatus("");
    try {
      const image = await preparePhoto(file);
      setPhoto(image);
      setRaw("");
      setText("");
      setSelected(null);
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function transcribe() {
    if (text && !confirm("Replace the current text with a new transcription?"))
      return;
    setBusy(true);
    setStatus("Reading your page…");
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session)
        throw new Error("Sign in again to scan this page.");
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({
          imageBase64: photo.split(",")[1],
          mimeType: "image/jpeg",
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not transcribe this page.");
      setRaw(result.text);
      setText(result.text);
      setStatus(
        "Read through the text, check [unclear] words, and save when ready.",
      );
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    setStatus("Saving your page…");
    let uploaded: string | null = null;
    try {
      const id = selected?.id || crypto.randomUUID();
      let imagePath = selected?.image_path || null;
      if (photo) {
        imagePath = `${session.user.id}/${id}.jpg`;
        const blob = await (await fetch(photo)).blob();
        const { error } = await supabase.storage
          .from("diary-pages")
          .upload(imagePath, blob, {
            contentType: "image/jpeg",
            upsert: false,
          });
        if (error) throw error;
        uploaded = imagePath;
      }
      const record = {
        title: title.trim() || "Untitled page",
        kind,
        entry_date: date,
        page_number: page,
        diary_id: diaryId || null,
        raw_transcription: raw,
        corrected_transcription: text,
        image_path: imagePath,
        image_url: selected?.image_url || "",
      };
      const result = selected
        ? await supabase
            .from("entries")
            .update(record)
            .eq("id", id)
            .eq("user_id", session.user.id)
            .select("id")
            .single()
        : await supabase
            .from("entries")
            .insert({ ...record, id, user_id: session.user.id })
            .select("id")
            .single();
      if (result.error) throw result.error;
      uploaded = null;
      setEditor(false);
      setSelected(null);
      setPhoto("");
      setText("");
      setRaw("");
      setLoaded(false);
      setActiveDiaryId(diaryId || "loose");
      setView("pages");
      setJumpPage(null);
      setRevision((r) => r + 1);
      setStatus("Page saved to your archive.");
    } catch (error) {
      if (uploaded) {
        const { error: cleanupError } = await supabase.storage
          .from("diary-pages")
          .remove([uploaded]);
        if (cleanupError)
          setStatus(
            "Save failed and photo cleanup failed. Your draft is still here.",
          );
      }
      setStatus(
        `Page was not saved: ${message(error)} Your draft is still here.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove(entry: Entry) {
    if (!confirm(`Delete “${entry.title}”? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("entries")
        .delete()
        .eq("id", entry.id)
        .eq("user_id", session.user.id)
        .select("id")
        .single();
      if (error) throw error;
      setEntries((old) => old.filter((e) => e.id !== entry.id));
      setEditor(false);
      setSelected(null);
      setPhoto("");
      setText("");
      if (entry.image_path) {
        const { error: cleanupError } = await supabase.storage
          .from("diary-pages")
          .remove([entry.image_path]);
        if (cleanupError) {
          setStatus(
            "Page deleted, but its photo could not be removed. Ask the project owner to clean up storage.",
          );
          return;
        }
      }
      setStatus("Page deleted.");
    } catch (error) {
      setStatus(`Could not delete: ${message(error)}`);
    } finally {
      setBusy(false);
    }
  }
  async function saveVocabulary() {
    setBusy(true);
    const { error } = await supabase.from("profiles").upsert({
      id: session.user.id,
      email: session.user.email,
      personal_lexicon: [
        ...new Set(
          vocabulary
            .split("\n")
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      ]
        .slice(0, 50)
        .map((v) => v.slice(0, 80)),
      updated_at: new Date().toISOString(),
    });
    setBusy(false);
    setStatus(
      error
        ? `Could not save vocabulary: ${error.message}`
        : "Personal vocabulary saved.",
    );
    if (!error) setPreferences(false);
  }
  function download() {
    const content = scopedPages
      .map(
        (e) =>
          `${e.title}\n${e.entry_date} · ${e.kind} · Page ${e.page_number || "?"}\n\n${e.corrected_transcription}`,
      )
      .join("\n\n--------------------\n\n");
    const url = URL.createObjectURL(
      new Blob(
        [
          `${currentDiary?.title || "Loose pages"}\n\nContents\n${scopedPages.map((entry) => `Page ${entry.page_number || "—"} · ${entry.title || "Untitled page"} · ${entry.entry_date}`).join("\n")}\n\n--------------------\n\n${content}`,
        ],
        { type: "text/plain;charset=utf-8" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(currentDiary?.title || "loose-pages").replace(/[^a-zA-Z0-9_-]/g, "_")}-${localDate()}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const visible = scopedPages.filter(
    (e) =>
      (filter === "all" || e.kind === filter) &&
      `${e.title} ${e.corrected_transcription} ${e.entry_date}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  return (
    <main className="workspace">
      <header>
        <div className="brand">
          <BookOpen size={26} /> Paper, kept close
        </div>
        <div className="header-actions">
          {area === "diaries" && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setPreferences((p) => !p)}
            >
              Vocabulary
            </button>
          )}
          <button
            className="icon-button secondary"
            aria-label="Sign out"
            disabled={busy || listBusy}
            onClick={async () => {
              if (
                (editor || listDirty) &&
                !confirm("Discard your draft and sign out?")
              )
                return;
              const { error } = await supabase.auth.signOut();
              if (error) setAccountStatus(error.message);
            }}
          >
            <LogOut size={19} />
          </button>
        </div>
      </header>
      {accountStatus && (
        <p className="notice" role="status">
          {accountStatus}
        </p>
      )}
      <nav className="workspace-tabs" aria-label="Your collection">
        {(
          [
            ["diaries", "Diaries"],
            ["lists", "Lists"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={area === value ? "secondary view-active" : "secondary"}
            aria-pressed={area === value}
            disabled={busy || listBusy}
            onClick={() => {
              if (area === value) return;
              if (
                (editor ||
                  listDirty ||
                  (diaryForm && (diaryTitle.trim() || coverPhoto))) &&
                !confirm("Discard your unsaved changes and switch sections?")
              )
                return;
              setEditor(false);
              setDiaryForm(false);
              setPhoto("");
              setText("");
              setCoverPhoto("");
              setListDirty(false);
              setListBusy(false);
              setArea(value);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {area === "lists" ? (
        <Lists
          session={session}
          onDirtyChange={setListDirty}
          onBusyChange={setListBusy}
        />
      ) : (
        <>
          <div
            className={`intro ${currentDiary?.cover_path ? "intro-with-cover" : ""}`}
          >
            {currentDiary?.cover_path && (
              <DiaryCover
                key={`${currentDiary.id}:${currentDiary.cover_path}`}
                diary={currentDiary}
              />
            )}
            <p className="eyebrow">
              {activeDiaryId === null
                ? "Your private collection"
                : "Your handwritten pages"}
            </p>
            <h1>
              {currentDiary?.title ||
                (activeDiaryId === "loose"
                  ? "Loose pages"
                  : "Your diaries, together.")}
            </h1>
            <p>
              {currentDiary?.description ||
                (activeDiaryId === "loose"
                  ? "Pages waiting for a diary. Open a page to file it."
                  : "A diary for every notebook, year, or part of your life.")}
            </p>
            <p className="small">Signed in as {session.user.email}</p>
          </div>
          {status && (
            <p className="notice" role="status">
              {status}
            </p>
          )}
          {preferences && (
            <section className="panel stack">
              <h2>Names and words you often write</h2>
              <p>
                Add one word or name per line, up to 50. These hints belong to
                your account and are sent to Gemini with your scans.
              </p>
              <label>
                Personal vocabulary
                <textarea
                  rows={5}
                  value={vocabulary}
                  onChange={(e) => setVocabulary(e.target.value)}
                  disabled={busy}
                />
              </label>
              <button disabled={busy} onClick={saveVocabulary}>
                Save vocabulary
              </button>
            </section>
          )}
          {!editor && activeDiaryId !== null && (
            <div className="row spread diary-navigation">
              <button
                className="text-button"
                disabled={busy}
                onClick={() => enterDiary(null)}
              >
                <ArrowLeft size={16} /> All diaries
              </button>
              {currentDiary && (
                <div className="row">
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => newDiary(currentDiary)}
                  >
                    Edit diary
                  </button>
                  {loaded && !scopedPages.length && (
                    <button
                      className="text-button danger"
                      disabled={busy}
                      onClick={() => deleteEmptyDiary(currentDiary)}
                    >
                      Delete empty diary
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {diaryForm && !editor && (
            <form className="panel stack" onSubmit={saveDiary}>
              <h2>{editingDiary ? "Edit diary" : "Create a diary"}</h2>
              <label>
                Diary name
                <input
                  required
                  maxLength={160}
                  value={diaryTitle}
                  onChange={(e) => setDiaryTitle(e.target.value)}
                  disabled={busy}
                  placeholder="My 2026 diary"
                />
              </label>
              <label>
                Description (optional)
                <textarea
                  maxLength={500}
                  rows={2}
                  value={diaryDescription}
                  onChange={(e) => setDiaryDescription(e.target.value)}
                  disabled={busy}
                  placeholder="What belongs in this diary?"
                />
              </label>
              <div className="cover-editor stack">
                <p>Cover image (optional)</p>
                {coverPhoto ? (
                  <img
                    className="diary-cover cover-preview"
                    src={coverPhoto}
                    alt="Selected diary cover"
                  />
                ) : editingDiary?.cover_path && !removeCover ? (
                  <DiaryCover
                    key={editingDiary.cover_path}
                    diary={editingDiary}
                  />
                ) : (
                  <div className="diary-cover-placeholder">
                    <BookOpen size={36} />
                  </div>
                )}
                <label className="upload-button">
                  <Camera size={18} />{" "}
                  {coverPhoto || (editingDiary?.cover_path && !removeCover)
                    ? "Replace cover"
                    : "Choose a cover photo"}
                  <input
                    type="file"
                    accept="image/*"
                    disabled={busy}
                    onChange={(e) => {
                      void chooseCover(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                {(coverPhoto || (editingDiary?.cover_path && !removeCover)) && (
                  <button
                    type="button"
                    className="text-button danger"
                    disabled={busy}
                    onClick={() => {
                      setCoverPhoto("");
                      setRemoveCover(true);
                    }}
                  >
                    Remove cover
                  </button>
                )}
                <p className="small">
                  Covers are private to your account. They are resized before
                  upload and are not sent to Gemini.
                </p>
              </div>
              <div className="row">
                <button disabled={busy || !diaryTitle.trim()}>
                  {busy
                    ? "Saving…"
                    : editingDiary
                      ? "Save diary"
                      : "Create diary"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setDiaryForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {editor ? (
            <section className="panel">
              <div className="row spread">
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm("Discard changes and return to your archive?")
                    ) {
                      setEditor(false);
                      setPhoto("");
                      setSelected(null);
                      setText("");
                    }
                  }}
                >
                  <ArrowLeft size={16} /> Back to archive
                </button>
                {selected && (
                  <button
                    className="danger text-button"
                    disabled={busy}
                    onClick={() => remove(selected)}
                  >
                    <Trash2 size={16} /> Delete page
                  </button>
                )}
              </div>
              <div className="editor-grid">
                <div className="stack">
                  <h2>{selected ? "Original page" : "Start with a photo"}</h2>
                  {photo ? (
                    <img
                      src={photo}
                      className="page-photo"
                      alt="Photo ready to transcribe"
                    />
                  ) : selected ? (
                    <PagePhoto key={selected.id} entry={selected} />
                  ) : (
                    <div className="photo-placeholder">
                      <Camera size={40} />
                      <p>Photograph the whole page in good light.</p>
                    </div>
                  )}
                  {!selected && (
                    <>
                      <label className="upload-button">
                        <Camera size={18} />{" "}
                        {photo
                          ? "Choose a different photo"
                          : "Take or choose a photo"}
                        <input
                          type="file"
                          accept="image/*"
                          disabled={busy}
                          onChange={(e) => {
                            void scan(e.target.files?.[0]);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <p className="small">
                        Your photo is resized before upload. Scanning sends it
                        to Google Gemini. Check that you are comfortable sharing
                        its contents.
                      </p>
                    </>
                  )}
                  {photo && (
                    <button disabled={busy} onClick={transcribe}>
                      {busy
                        ? "Please wait…"
                        : text
                          ? "Read photo again"
                          : "Read handwriting"}
                    </button>
                  )}
                </div>
                <form
                  className="stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save();
                  }}
                >
                  <h2>{selected ? "Edit your page" : "Review and save"}</h2>
                  <label>
                    Title
                    <input
                      maxLength={160}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      disabled={busy}
                      placeholder="Give this page a name"
                    />
                  </label>
                  <label>
                    Diary
                    <select
                      value={diaryId}
                      disabled={busy}
                      onChange={(e) => {
                        setDiaryId(e.target.value);
                        setPage(
                          nextPageNumber(
                            entries.filter((item) => item.id !== selected?.id),
                            e.target.value || null,
                          ),
                        );
                      }}
                    >
                      <option value="">Loose pages (no diary)</option>
                      {diaries.map((diary) => (
                        <option key={diary.id} value={diary.id}>
                          {diary.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="field-grid">
                    <label>
                      Save as
                      <select
                        value={kind}
                        onChange={(e) => setKind(e.target.value as Kind)}
                        disabled={busy}
                      >
                        {kinds.map((k) => (
                          <option key={k.value} value={k.value}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Written on
                      <input
                        type="date"
                        required
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        disabled={busy}
                      />
                    </label>
                    <label>
                      Page number
                      <input
                        type="number"
                        min={1}
                        max={1000000}
                        required
                        value={page}
                        onChange={(e) => setPage(Number(e.target.value))}
                        disabled={busy}
                      />
                    </label>
                  </div>
                  <label>
                    Page text
                    <textarea
                      className="transcription"
                      required
                      rows={14}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      disabled={busy}
                      placeholder="Your transcription appears here. You can also type a page yourself."
                    />
                  </label>
                  <p className="small">
                    Your wording stays yours. Check unclear words, spelling, and
                    numbers before saving.
                  </p>
                  <button disabled={busy || !text.trim()}>
                    {busy ? "Please wait…" : "Save to my archive"}
                  </button>
                </form>
              </div>
            </section>
          ) : activeDiaryId === null ? (
            <section aria-label="Your diaries">
              <div className="row spread shelf-heading">
                <p className="small">
                  {loaded
                    ? `${diaries.length} ${diaries.length === 1 ? "diary" : "diaries"}`
                    : "Loading your collection…"}
                </p>
                <button disabled={busy || !loaded} onClick={() => newDiary()}>
                  <Plus size={18} /> New diary
                </button>
              </div>
              {!loaded ? (
                <button
                  className="secondary"
                  onClick={() => setRevision((r) => r + 1)}
                >
                  Reload collection
                </button>
              ) : (
                <>
                  {!diaries.length && (
                    <div className="empty">
                      <BookOpen size={42} />
                      <h2>Create your first diary.</h2>
                      <p>
                        Keep all the pages of a notebook together. You can
                        create as many diaries as you need.
                      </p>
                      <button disabled={busy} onClick={() => newDiary()}>
                        <Plus size={18} /> Create a diary
                      </button>
                    </div>
                  )}
                  <div className="cards diary-shelf">
                    {diaries.map((diary) => {
                      const pages = pagesInDiary(entries, diary.id);
                      return (
                        <button
                          className="entry-card diary-card"
                          key={diary.id}
                          disabled={busy}
                          onClick={() => enterDiary(diary.id)}
                        >
                          <DiaryCover
                            key={`${diary.id}:${diary.cover_path || "none"}`}
                            diary={diary}
                          />
                          <h2>{diary.title}</h2>
                          <p>
                            {diary.description ||
                              "Your handwritten pages, kept together."}
                          </p>
                          <span className="small">
                            {pages.length}{" "}
                            {pages.length === 1 ? "page" : "pages"} · Open diary
                            →
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    className="loose-pages secondary"
                    disabled={busy}
                    onClick={() => enterDiary("loose")}
                  >
                    <span>Loose pages</span>
                    <span>
                      {loosePages.length}{" "}
                      {loosePages.length === 1 ? "page" : "pages"} · Open →
                    </span>
                  </button>
                </>
              )}
            </section>
          ) : (
            <>
              <div className="toolbar">
                <label className="search">
                  <Search size={18} />
                  <input
                    aria-label="Search this diary"
                    placeholder="Search titles, words, or dates"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Filter by type"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">All pages</option>
                  {kinds.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <button onClick={() => open(null)} disabled={busy || !loaded}>
                  <Plus size={18} /> Add a page
                </button>
              </div>
              <div className="row spread">
                <p className="small">
                  {loaded
                    ? `${scopedPages.length} saved ${scopedPages.length === 1 ? "page" : "pages"}`
                    : "Loading your pages…"}
                </p>
                <div className="row">
                  <div className="view-controls" aria-label="Diary view">
                    {(
                      [
                        ["pages", "Pages"],
                        ["index", "Index"],
                        ["book", "Read as book"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        className={
                          view === value ? "view-active secondary" : "secondary"
                        }
                        aria-pressed={view === value}
                        disabled={!loaded || !scopedPages.length}
                        onClick={() => {
                          setView(value);
                          setJumpPage(null);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    className="text-button"
                    onClick={download}
                    disabled={!loaded || !scopedPages.length}
                  >
                    <Download size={16} /> Export{" "}
                    {currentDiary ? "diary" : "loose pages"}
                  </button>
                </div>
              </div>
              {!loaded ? (
                <button
                  className="secondary"
                  onClick={() => setRevision((r) => r + 1)}
                >
                  Reload pages
                </button>
              ) : !visible.length ? (
                <section className="empty">
                  <BookOpen size={42} />
                  <h2>
                    {scopedPages.length
                      ? "No matching pages"
                      : "Your first page starts here."}
                  </h2>
                  <p>
                    {scopedPages.length
                      ? "Try a different search or type."
                      : "Take a photo of your notebook, review the words, and save."}
                  </p>
                  {!scopedPages.length && (
                    <button onClick={() => open(null)}>
                      <Camera size={18} /> Add your first page
                    </button>
                  )}
                </section>
              ) : view === "index" ? (
                <section className="diary-index panel" aria-label="Diary index">
                  <h2>Contents</h2>
                  <p className="small">
                    Updated from your page titles and numbers. Select a page to
                    read it.
                  </p>
                  <ol>
                    {visible.map((entry) => (
                      <li key={entry.id}>
                        <button
                          className="index-row"
                          onClick={() => {
                            setView("book");
                            setJumpPage(entry.id);
                          }}
                        >
                          <span className="index-number">
                            Page {entry.page_number || "—"}
                          </span>
                          <span className="index-title">
                            {entry.title || "Untitled page"}
                          </span>
                          <time dateTime={entry.entry_date}>
                            {entry.entry_date}
                          </time>
                          <span aria-hidden="true">→</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : view === "book" ? (
                <section className="book-reader" aria-label="Read diary">
                  {visible.map((entry) => (
                    <article
                      key={entry.id}
                      id={`page-${entry.id}`}
                      tabIndex={-1}
                      className="book-page"
                    >
                      <p className="eyebrow">
                        Page {entry.page_number || "—"} · {entry.entry_date}
                      </p>
                      <h2>{entry.title || "Untitled page"}</h2>
                      <p className="book-text">
                        {entry.corrected_transcription}
                      </p>
                      <button
                        className="text-button"
                        onClick={() => open(entry)}
                      >
                        Edit page {entry.page_number || ""} →
                      </button>
                    </article>
                  ))}
                </section>
              ) : (
                <div className="cards">
                  {visible.map((entry) => (
                    <button
                      className="entry-card"
                      key={entry.id}
                      onClick={() => open(entry)}
                    >
                      <span className="eyebrow">
                        {kinds.find((k) => k.value === entry.kind)?.label ||
                          "Journal"}{" "}
                        · {entry.entry_date}
                      </span>
                      <h2>{entry.title || "Untitled page"}</h2>
                      <p>{entry.corrected_transcription}</p>
                      <span className="small">
                        Page {entry.page_number || "—"} · Open page →
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
      <footer>
        Your archive is private to your account. On iPhone, use Share → Add to
        Home Screen.
      </footer>
    </main>
  );
}
