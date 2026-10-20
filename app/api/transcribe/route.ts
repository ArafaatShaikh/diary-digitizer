import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export async function POST(req: NextRequest) {
  try {
    const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is missing from environment variables (.env.local or Vercel)." },
        { status: 500 }
      );
    }

    const { imageBase64, mimeType, handwritingProfile } = await req.json();

    if (!imageBase64) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const ai = new GoogleGenAI({ apiKey });

    const lexiconNotes = handwritingProfile?.personal_lexicon?.length
      ? `Recognized personal vocabulary & names: ${handwritingProfile.personal_lexicon.join(", ")}`
      : "No prior personal vocabulary recorded.";

    const quirkNotes = handwritingProfile?.character_quirks?.length
      ? `Observed penmanship habits: ${handwritingProfile.character_quirks.join("; ")}`
      : "No specific handwriting quirks recorded yet.";

    const prompt = `
You are an expert paleographer and manuscript transcriber specializing in personal journals, letters, and cursive penmanship.
Transcribe the handwritten text from this image with high fidelity.

CRITICAL LANGUAGE & SCRIPT RULES:
1. Preserve the EXACT language and script written on the page (Bangla / Bengali script, English, or a mix of both).
2. DO NOT translate anything. If the manuscript is written in Bengali, transcribe it in authentic Bengali script (বাংলা লিপি).
3. Faithfully capture Bengali diacritics (কার চিহ্ন), conjuncts (যুক্তবর্ণ), punctuation, line breaks, and formatting.
4. If the author mixes English and Bangla (code-switching), transcribe each word in its respective original script.

AUTHOR PENMANSHIP PROFILE:
- ${lexiconNotes}
- ${quirkNotes}

Return ONLY the transcribed text. Do not add commentary, greetings, notes, or markdown formatting blocks.
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: mimeType || "image/jpeg",
                data: imageBase64,
              },
            },
          ],
        },
      ],
    });

    const transcription = response.text || "";
    return NextResponse.json({ text: transcription });
  } catch (error: any) {
    console.error("Transcription error:", error);
    return NextResponse.json({ error: error.message || "Failed to transcribe manuscript" }, { status: 500 });
  }
}
