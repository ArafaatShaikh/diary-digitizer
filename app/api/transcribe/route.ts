import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mimeType, handwritingProfile } = await req.json();

    if (!imageBase64) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const lexicon = handwritingProfile?.personal_lexicon?.join(", ") || "None recorded yet";
    const quirks = handwritingProfile?.character_quirks?.join("; ") || "None recorded yet";

    const prompt = `
You are transcribing a personal handwritten journal entry word-for-word.
Preserve exact line breaks, paragraph structure, dates, and spelling.
Do NOT summarize, correct grammar, or omit strike-through words unless explicitly legible.

AUTHOR'S LEARNED HANDWRITING PROFILE:
- Known Custom Vocabulary / Names: ${lexicon}
- Observed Penmanship Quirks: ${quirks}

Transcribe the handwritten text in the attached image accurately:
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: imageBase64,
                mimeType: mimeType || "image/jpeg",
              },
            },
          ],
        },
      ],
    });

    return NextResponse.json({ text: response.text || "" });
  } catch (error: any) {
    console.error("Transcribe API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
