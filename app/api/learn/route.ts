import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { rawTranscription, correctedTranscription, existingProfile } = await req.json();

    if (!rawTranscription || !correctedTranscription) {
      return NextResponse.json({ updatedProfile: existingProfile || {} });
    }

    if (rawTranscription.trim() === correctedTranscription.trim()) {
      return NextResponse.json({ updatedProfile: existingProfile || {}, notes: "No changes detected." });
    }

    const prompt = `
Compare the raw OCR transcription with the author's verified text.
Identify:
1. Unique vocabulary, personal names, pet names, or foreign locations.
2. Handwriting quirks (e.g. how she writes cursive 'r', 's', numbers, or ambiguous ligatures).

RAW OCR:
"""${rawTranscription}"""

VERIFIED TEXT:
"""${correctedTranscription}"""

CURRENT PROFILE:
${JSON.stringify(existingProfile || { personal_lexicon: [], character_quirks: [] })}

Merge new learnings with current profile. Return ONLY valid JSON matching this schema without markdown code blocks:
{
  "personal_lexicon": ["unique names or vocabulary"],
  "character_quirks": ["distinctive stroke or letter habits"]
}
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const cleaned = (response.text || "{}").replace(/```json/g, "").replace(/```/g, "").trim();
    const updatedProfile = JSON.parse(cleaned);

    return NextResponse.json({ updatedProfile });
  } catch (error: any) {
    console.error("Learn API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
