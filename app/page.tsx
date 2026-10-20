"use client";

import { useState } from "react";
import { Camera, Save, Sparkles, BookOpen, UserCheck, RefreshCw } from "lucide-react";

interface HandwritingProfile {
  personal_lexicon: string[];
  character_quirks: string[];
}

export default function DiaryApp() {
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
  const [showProfileModal, setShowProfileModal] = useState(false);

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
    setStatusMessage("Analyzing corrections to adapt AI to her penmanship...");

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
      if (data.updatedProfile) {
        setProfile(data.updatedProfile);
        setStatusMessage("Saved! Handwriting profile updated with new vocabulary & quirks.");
      }
    } catch (err: any) {
      setStatusMessage(`Error updating profile: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

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
            onClick={() => setShowProfileModal(!showProfileModal)}
            className="border border-stone-300 hover:bg-stone-50 text-stone-700 px-3 py-2 rounded flex items-center gap-2 transition"
          >
            <UserCheck size={16} /> Handwriting Memory ({profile.character_quirks.length + profile.personal_lexicon.length})
          </button>

          <label className="cursor-pointer bg-stone-900 hover:bg-stone-800 text-stone-100 px-4 py-2 rounded flex items-center gap-2 transition shadow-sm">
            <Camera size={16} /> Scan Page
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageUpload} />
          </label>
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
              <span className="text-xs font-sans text-stone-400">Fixing words trains her AI</span>
            </div>

            <textarea
              className="w-full flex-grow p-4 border border-stone-200 rounded-md text-stone-900 bg-[#FCFBF9] leading-relaxed focus:outline-none focus:ring-1 focus:ring-stone-400 min-h-[450px] text-base"
              value={correctedText}
              onChange={(e) => setCorrectedText(e.target.value)}
              placeholder="The transcribed page will appear here. Edit any words that were misread to calibrate her handwriting profile..."
            />

            <button
              onClick={handleSaveAndLearn}
              disabled={loading || !correctedText}
              className="mt-4 bg-stone-900 hover:bg-stone-800 text-white py-2.5 rounded font-sans text-sm flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              <Save size={16} /> {loading ? "Updating Profile..." : "Save & Teach AI Her Style"}
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
                  <p className="text-xs text-stone-400 italic">No custom words logged yet. They will appear as she corrects entries.</p>
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
              <button
                onClick={() => setShowProfileModal(false)}
                className="px-4 py-2 bg-stone-900 text-white rounded text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
