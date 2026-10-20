"use client";

import { useState, useEffect } from "react";
import { 
  Camera, Save, Sparkles, BookOpen, UserCheck, RefreshCw, 
  Archive, Clock, Lock, Unlock, Download, Copy, Check, Trash2, 
  ChevronRight, ArrowLeft, BookMarked
} from "lucide-react";
import { supabase } from "@/lib/supabase";

interface HandwritingProfile {
  personal_lexicon: string[];
  character_quirks: string[];
}

interface JournalEntry {
  id: string;
  image_url: string;
  raw_transcription: string;
  corrected_transcription: string;
  created_at: string;
}

const DEFAULT_PROFILE_ID = "00000000-0000-0000-0000-000000000001";

export default function DiaryApp() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [passcode, setPasscode] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [rawText, setRawText] = useState("");
  const [correctedText, setCorrectedText] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [profile, setProfile] = useState<HandwritingProfile>({
    personal_lexicon: [],
    character_quirks: [],
  });
  
  // Archive & Reader states
  const [pastEntries, setPastEntries] = useState<JournalEntry[]>([]);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showEntriesModal, setShowEntriesModal] = useState(false);
  const [archiveView, setArchiveView] = useState<"list" | "book" | "single">("list");
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const savedAuth = localStorage.getItem("diary_authenticated");
    if (savedAuth === "true") {
      setIsAuthenticated(true);
      fetchProfile();
      fetchEntries();
    } else {
      setIsAuthenticated(false);
    }
  }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError("");

    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        localStorage.setItem("diary_authenticated", "true");
        setIsAuthenticated(true);
        fetchProfile();
        fetchEntries();
      } else {
        setAuthError("Incorrect passcode. Try again.");
      }
    } catch {
      setAuthError("Connection error. Try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLock = () => {
    localStorage.removeItem("diary_authenticated");
    setIsAuthenticated(false);
    setPasscode("");
  };

  const fetchProfile = async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("personal_lexicon, character_quirks")
        .eq("id", DEFAULT_PROFILE_ID)
        .single();

      if (data && !error) {
        setProfile({
          personal_lexicon: data.personal_lexicon || [],
          character_quirks: data.character_quirks || [],
        });
      }
    } catch (err) {
      console.error("Error loading profile from Supabase:", err);
    }
  };

  const fetchEntries = async () => {
    try {
      const { data, error } = await supabase
        .from("entries")
        .select("*")
        .order("created_at", { ascending: false });

      if (data && !error) {
        setPastEntries(data as JournalEntry[]);
      }
    } catch (err) {
      console.error("Error loading entries from Supabase:", err);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    if (!confirm("Are you sure you want to delete this page from the archive?")) return;
    try {
      await supabase.from("entries").delete().eq("id", id);
      setPastEntries((prev) => prev.filter((item) => item.id !== id));
      if (selectedEntry?.id === id) {
        setSelectedEntry(null);
        setArchiveView("list");
      }
    } catch (err) {
      console.error("Error deleting entry:", err);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatusMessage("");
    const reader = new FileReader();
    reader.onloadend = () => {
      const fullString = reader.result as string;
      const base64Data = fullString.split(",")[1];
      setImageBase64(base64Data);
      setImagePreview(fullString);
      setRawText("");
      setCorrectedText("");
    };
    reader.readAsDataURL(file);
  };

  const handleTranscribe = async () => {
    if (!imageBase64) return;
    setLoading(true);
    setStatusMessage("Reading manuscript using her personal handwriting profile...");

    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64,
          mimeType: "image/jpeg",
          handwritingProfile: profile,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setRawText(data.text);
      setCorrectedText(data.text);
      setStatusMessage("Transcribed! Review and correct any misread words below.");
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAndLearn = async () => {
    setLoading(true);
    setStatusMessage("Analyzing corrections and saving to her permanent archive...");

    try {
      const res = await fetch("/api/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawTranscription: rawText,
          correctedTranscription: correctedText,
          existingProfile: profile,
        }),
      });
      const data = await res.json();

      const updatedProfile = data.updatedProfile || profile;
      setProfile(updatedProfile);

      await supabase
        .from("profiles")
        .update({
          personal_lexicon: updatedProfile.personal_lexicon,
          character_quirks: updatedProfile.character_quirks,
          updated_at: new Date().toISOString(),
        })
        .eq("id", DEFAULT_PROFILE_ID);

      await supabase.from("entries").insert({
        image_url: imagePreview || "",
        raw_transcription: rawText,
        corrected_transcription: correctedText,
      });

      await fetchEntries();
      setStatusMessage("Saved! Diary entry archived & handwriting memory permanently updated.");
    } catch (err: any) {
      setStatusMessage(`Error saving: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Compile all entries into one chronological text block
  const getCompiledText = () => {
    return [...pastEntries]
      .reverse()
      .map((entry) => {
        const dateStr = new Date(entry.created_at).toLocaleDateString(undefined, {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        return `═══════════════════════════════════════\n${dateStr}\n═══════════════════════════════════════\n\n${entry.corrected_transcription}\n\n`;
      })
      .join("\n");
  };

  const handleCopyCompiled = () => {
    navigator.clipboard.writeText(getCompiledText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadCompiled = () => {
    const text = getCompiledText();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `diary_manuscript_${new Date().toISOString().split("T")[0]}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (isAuthenticated === null) return null;

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-[#FDFBF7] flex items-center justify-center p-4 font-serif">
        <div className="max-w-md w-full bg-white p-8 rounded-xl border border-stone-200 shadow-sm text-center">
          <div className="w-12 h-12 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-4 text-stone-700">
            <Lock size={22} />
          </div>
          <h1 className="text-2xl font-light text-stone-900 mb-1">Private Journal</h1>
          <p className="text-xs font-sans text-stone-500 mb-6">Enter the passcode to view and digitize entries.</p>

          <form onSubmit={handleUnlock} className="space-y-4 font-sans">
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Enter passcode"
              className="w-full px-4 py-2.5 text-center text-lg tracking-widest text-stone-900 bg-white placeholder:text-stone-400 border border-stone-400 rounded-md focus:outline-none focus:ring-2 focus:ring-stone-800 focus:border-stone-800"
              autoFocus
            />

            {authError && <p className="text-xs text-rose-600">{authError}</p>}

            <button
              type="submit"
              disabled={authLoading || !passcode}
              className="w-full bg-stone-900 hover:bg-stone-800 text-white py-2.5 rounded-md text-sm font-medium transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Unlock size={16} /> {authLoading ? "Verifying..." : "Unlock Journal"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FDFBF7] text-stone-800 p-4 md:p-8 font-serif">
      <header className="max-w-6xl mx-auto mb-8 border-b border-stone-200 pb-4 flex flex-wrap justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-normal tracking-wide text-stone-900 flex items-center gap-2">
            <BookOpen className="text-stone-700" size={28} /> Manuscript & Letters
          </h1>
          <p className="text-xs md:text-sm font-sans text-stone-500 mt-1">
            Personal diary digitizer with adaptive handwriting calibration
          </p>
        </div>

        <div className="flex items-center gap-3 font-sans text-sm">
          <button
            onClick={() => {
              setArchiveView("list");
              setShowEntriesModal(true);
            }}
            className="border border-stone-300 hover:bg-stone-50 text-stone-700 px-3 py-2 rounded flex items-center gap-2 transition"
          >
            <Archive size={16} /> Archive ({pastEntries.length})
          </button>

          <button
            onClick={() => setShowProfileModal(!showProfileModal)}
            className="border border-stone-300 hover:bg-stone-50 text-stone-700 px-3 py-2 rounded flex items-center gap-2 transition"
          >
            <UserCheck size={16} /> Memory ({profile.character_quirks.length + profile.personal_lexicon.length})
          </button>

          <label className="cursor-pointer bg-stone-900 hover:bg-stone-800 text-stone-100 px-4 py-2 rounded flex items-center gap-2 transition shadow-sm">
            <Camera size={16} /> Scan Page
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageUpload} />
          </label>

          <button
            onClick={handleLock}
            title="Lock Journal"
            className="p-2 border border-stone-300 hover:bg-stone-100 text-stone-600 rounded transition"
          >
            <Lock size={16} />
          </button>
        </div>
      </header>

      {statusMessage && (
        <div className="max-w-6xl mx-auto mb-6 p-3 bg-stone-100 border border-stone-300 rounded font-sans text-xs md:text-sm text-stone-700 flex items-center justify-between">
          <span>{statusMessage}</span>
          {loading && <RefreshCw className="animate-spin text-stone-500" size={14} />}
        </div>
      )}

      {imagePreview ? (
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-white p-5 rounded-lg border border-stone-200 shadow-sm flex flex-col">
            <h2 className="text-xs font-sans uppercase tracking-widest text-stone-400 mb-3">Original Manuscript</h2>
            <div className="flex-grow flex items-center justify-center bg-stone-50 rounded border border-dashed border-stone-200 p-2 overflow-hidden">
              <img src={imagePreview} alt="Manuscript" className="max-h-[600px] w-auto object-contain rounded" />
            </div>

            {!rawText && (
              <button
                onClick={handleTranscribe}
                disabled={loading}
                className="mt-4 w-full bg-stone-900 hover:bg-stone-800 text-white py-2.5 rounded font-sans text-sm flex items-center justify-center gap-2 transition disabled:opacity-50"
              >
                <Sparkles size={16} /> {loading ? "Analyzing Penmanship..." : "Transcribe Manuscript"}
              </button>
            )}
          </div>

          <div className="bg-white p-5 rounded-lg border border-stone-200 shadow-sm flex flex-col">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-xs font-sans uppercase tracking-widest text-stone-400">Digital Version (Editable)</h2>
              <span className="text-xs font-sans text-stone-400">Edits permanently adapt her model</span>
            </div>

            <textarea
              className="w-full flex-grow p-4 border border-stone-200 rounded-md text-stone-900 bg-[#FCFBF9] leading-relaxed focus:outline-none focus:ring-1 focus:ring-stone-400 min-h-[450px] text-base"
              value={correctedText}
              onChange={(e) => setCorrectedText(e.target.value)}
              placeholder="The transcribed page will appear here..."
            />

            <button
              onClick={handleSaveAndLearn}
              disabled={loading || !correctedText}
              className="mt-4 bg-stone-900 hover:bg-stone-800 text-white py-2.5 rounded font-sans text-sm flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              <Save size={16} /> {loading ? "Saving..." : "Save to Archive & Adapt AI"}
            </button>
          </div>
        </div>
      ) : (
        <div className="max-w-2xl mx-auto mt-16 p-12 text-center border-2 border-dashed border-stone-300 rounded-xl bg-white/60">
          <BookOpen className="mx-auto text-stone-400 mb-4" size={44} />
          <h2 className="text-xl font-medium text-stone-800 mb-2">No page selected</h2>
          <p className="text-stone-500 font-sans text-sm mb-6">
            Upload or take a photo of a handwritten journal page or letter to begin.
          </p>
          <label className="inline-flex cursor-pointer bg-stone-900 hover:bg-stone-800 text-white px-5 py-2.5 rounded font-sans text-sm items-center gap-2 transition">
            <Camera size={16} /> Select or Snap Photo
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageUpload} />
          </label>
        </div>
      )}

      {/* Archive & Book Reader Modal */}
      {showEntriesModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-3 md:p-6 z-50">
          <div className="bg-[#FAF9F5] max-w-4xl w-full rounded-xl border border-stone-300 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="bg-white px-6 py-4 border-b border-stone-200 flex justify-between items-center">
              <div className="flex items-center gap-3">
                {archiveView !== "list" && (
                  <button
                    onClick={() => setArchiveView("list")}
                    className="p-1 hover:bg-stone-100 rounded text-stone-600 transition"
                    title="Back to list"
                  >
                    <ArrowLeft size={18} />
                  </button>
                )}
                <div>
                  <h3 className="text-lg font-serif font-medium text-stone-900 flex items-center gap-2">
                    <Archive size={18} />
                    {archiveView === "book" ? "Full Compiled Manuscript" : archiveView === "single" ? "Journal Page" : "Digitized Archive"}
                  </h3>
                  <p className="text-xs font-sans text-stone-400">
                    {pastEntries.length} {pastEntries.length === 1 ? "page" : "pages"} digitized
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 font-sans text-xs">
                {pastEntries.length > 0 && archiveView === "list" && (
                  <button
                    onClick={() => setArchiveView("book")}
                    className="bg-stone-900 hover:bg-stone-800 text-white px-3 py-1.5 rounded flex items-center gap-1.5 transition"
                  >
                    <BookMarked size={14} /> Read as Book
                  </button>
                )}

                {archiveView === "book" && (
                  <>
                    <button
                      onClick={handleCopyCompiled}
                      className="border border-stone-300 hover:bg-stone-100 text-stone-700 px-3 py-1.5 rounded flex items-center gap-1.5 transition"
                    >
                      {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                      {copied ? "Copied" : "Copy All"}
                    </button>
                    <button
                      onClick={handleDownloadCompiled}
                      className="bg-stone-900 hover:bg-stone-800 text-white px-3 py-1.5 rounded flex items-center gap-1.5 transition"
                    >
                      <Download size={14} /> Export .txt
                    </button>
                  </>
                )}

                <button
                  onClick={() => setShowEntriesModal(false)}
                  className="text-stone-400 hover:text-stone-700 text-lg ml-2 px-2"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto p-6 flex-grow">
              {/* VIEW 1: Cards List */}
              {archiveView === "list" && (
                <div className="space-y-3">
                  {pastEntries.length === 0 ? (
                    <div className="text-center py-12 text-stone-400 font-sans text-sm">
                      No entries archived yet. Transcribe and save a page to see it here.
                    </div>
                  ) : (
                    pastEntries.map((entry) => (
                      <div
                        key={entry.id}
                        onClick={() => {
                          setSelectedEntry(entry);
                          setArchiveView("single");
                        }}
                        className="p-5 border border-stone-200 bg-white hover:border-stone-400 rounded-lg cursor-pointer transition shadow-xs group"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-1.5 text-xs text-stone-500 font-sans">
                            <Clock size={13} />
                            {new Date(entry.created_at).toLocaleDateString(undefined, {
                              weekday: "short",
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                            })}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteEntry(entry.id);
                              }}
                              title="Delete entry"
                              className="text-stone-300 hover:text-rose-600 p-1 transition"
                            >
                              <Trash2 size={14} />
                            </button>
                            <ChevronRight size={16} className="text-stone-300 group-hover:text-stone-700 transition" />
                          </div>
                        </div>
                        <p className="font-serif text-sm text-stone-800 whitespace-pre-wrap leading-relaxed line-clamp-3">
                          {entry.corrected_transcription}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* VIEW 2: Single Entry Unabridged Inspector */}
              {archiveView === "single" && selectedEntry && (
                <div className="max-w-2xl mx-auto space-y-6">
                  <div className="flex justify-between items-center pb-3 border-b border-stone-200">
                    <span className="text-xs font-sans text-stone-500 flex items-center gap-1">
                      <Clock size={13} />
                      {new Date(selectedEntry.created_at).toLocaleDateString(undefined, {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </span>
                    <button
                      onClick={() => handleDeleteEntry(selectedEntry.id)}
                      className="text-xs font-sans text-rose-600 hover:text-rose-800 flex items-center gap-1"
                    >
                      <Trash2 size={13} /> Delete Page
                    </button>
                  </div>

                  {selectedEntry.image_url && (
                    <div className="bg-white p-3 border border-stone-200 rounded-lg shadow-xs flex justify-center">
                      <img
                        src={selectedEntry.image_url}
                        alt="Original handwritten page"
                        className="max-h-[350px] w-auto object-contain rounded"
                      />
                    </div>
                  )}

                  <div className="bg-white p-6 rounded-lg border border-stone-200 shadow-xs">
                    <h4 className="text-xs font-sans uppercase tracking-widest text-stone-400 mb-3">Digitized Text</h4>
                    <p className="font-serif text-base text-stone-900 leading-relaxed whitespace-pre-wrap">
                      {selectedEntry.corrected_transcription}
                    </p>
                  </div>
                </div>
              )}

              {/* VIEW 3: Compiled "Read as Book" Format */}
              {archiveView === "book" && (
                <div className="max-w-2xl mx-auto bg-white p-8 md:p-12 rounded-lg border border-stone-200 shadow-sm font-serif">
                  <div className="text-center mb-10 pb-6 border-b border-stone-200">
                    <h2 className="text-2xl font-normal text-stone-900 tracking-wide mb-1">Journal & Letters</h2>
                    <p className="text-xs font-sans text-stone-400">Complete digitized chronological archive</p>
                  </div>

                  <div className="space-y-12">
                    {[...pastEntries].reverse().map((entry, idx) => (
                      <article key={entry.id} className="relative">
                        <div className="flex items-center gap-3 mb-4">
                          <span className="font-sans text-xs tracking-widest uppercase font-semibold text-stone-500">
                            {new Date(entry.created_at).toLocaleDateString(undefined, {
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                            })}
                          </span>
                          <div className="flex-grow border-t border-stone-200" />
                          <span className="text-xs font-sans text-stone-300">p. {idx + 1}</span>
                        </div>
                        <p className="text-stone-900 leading-loose text-base whitespace-pre-wrap">
                          {entry.corrected_transcription}
                        </p>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Profile Memory Modal */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white max-w-lg w-full rounded-lg p-6 border border-stone-200 font-sans">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-stone-900">Learned Penmanship Profile</h3>
              <button onClick={() => setShowProfileModal(false)} className="text-stone-400 hover:text-stone-700">✕</button>
            </div>

            <div className="space-y-4 text-sm text-stone-700 max-h-[60vh] overflow-y-auto">
              <div>
                <h4 className="font-semibold text-xs text-stone-500 uppercase tracking-wider mb-1">Personal Names & Lexicon:</h4>
                {profile.personal_lexicon.length === 0 ? (
                  <p className="text-xs text-stone-400 italic">No custom words logged yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {profile.personal_lexicon.map((word, i) => (
                      <span key={i} className="px-2 py-0.5 bg-stone-100 border border-stone-200 rounded text-xs">{word}</span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="font-semibold text-xs text-stone-500 uppercase tracking-wider mb-1">Observed Character Habits:</h4>
                {profile.character_quirks.length === 0 ? (
                  <p className="text-xs text-stone-400 italic">No penmanship quirks recorded yet.</p>
                ) : (
                  <ul className="list-disc pl-4 text-xs space-y-1 text-stone-600">
                    {profile.character_quirks.map((quirk, i) => (
                      <li key={i}>{quirk}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button onClick={() => setShowProfileModal(false)} className="px-4 py-2 bg-stone-900 text-white rounded text-xs">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
