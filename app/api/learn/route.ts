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

    const { rawTranscription, correctedTranscription, existingProfile } = await req.json();

    const currentLexicon = existingProfile?.personal_lexicon || [];
    const currentQuirks = existingProfile?.character_quirks || [];

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
You are an adaptive handwriting calibration assistant analyzing transcription corrections for a personal diary.
The author writes in English, Bangla (Bengali), or a mix of both.

Raw AI Transcription:
"${rawTranscription}"

Author's Corrected Transcription:
"${correctedTranscription}"

Existing Personal Lexicon:
${JSON.stringify(currentLexicon)}

Existing Penmanship Quirks:
${JSON.stringify(currentQuirks)}

TASK:
1. Identify any personal names, nicknames, Bengali terms/words, slang, or recurring terms present in the corrected text that the raw AI misidentified.
2. Deduce specific penmanship quirks (e.g., how the author forms specific Bengali letters, matra lines, vowel diacritics, or English cursive letters).
3. Merge new findings into the existing lists without duplicating items. Keep the lists concise and high-signal (maximum 50 items each).

Respond ONLY with valid JSON in this exact structure:
{
  "personal_lexicon": ["word1", "word2"],
  "character_quirks": ["quirk description 1", "quirk description 2"]
}
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
      },
    });

    const rawResponse = response.text || "{}";
    const parsed = JSON.parse(rawResponse);

    return NextResponse.json({
      updatedProfile: {
        personal_lexicon: parsed.personal_lexicon || currentLexicon,
        character_quirks: parsed.character_quirks || currentQuirks,
      },
    });
  } catch (error: any) {
    console.error("Learn route error:", error);
    return NextResponse.json({ error: error.message || "Failed to analyze corrections" }, { status: 500 });
  }
}
