export const NARRATION_CHUNK = 800;
export function narrationChunks(text: string): string[] {
  const points = Array.from(text.trim());
  const chunks: string[] = [];
  while (points.length) {
    let end = Math.min(points.length, NARRATION_CHUNK);
    if (end < points.length) {
      const candidate = points.slice(0, end).join('');
      const boundary = candidate.search(/[.!?।\n]\s+[^.!?।\n]*$/u);
      const count = boundary < 0 ? 0 : Array.from(candidate.slice(0, boundary)).length + 1;
      if (count > end / 2) end = count;
    }
    chunks.push(points.splice(0, end).join(''));
  }
  return chunks;
}
export class NarrationError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}
export async function generateNarration(text: string, env = process.env, send = fetch) {
  const googleKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!googleKey) throw new NarrationError('Google narration is not configured.', 503);
  const google = await send('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': googleKey },
    signal: AbortSignal.timeout(22000),
    body: JSON.stringify({ model: 'gemini-3.8-flash-lite-tts', store: false,
      input: [{ type: 'user_input', content: [{ type: 'text', text,
        annotations: [{ type: 'speech_metadata', style: 'Calm, natural audiobook narration. Read the text verbatim in its original language.' }] }] }],
      response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice: 'Kore' }] } }),
  });
  if (google.status === 429) {
    if (!env.ELEVENLABS_API_KEY || !env.ELEVENLABS_VOICE_ID)
      throw new NarrationError('Google quota reached. ElevenLabs fallback is not configured.', 429);
    const eleven = await send(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(env.ELEVENLABS_VOICE_ID)}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': env.ELEVENLABS_API_KEY },
      signal: AbortSignal.timeout(22000),
      body: JSON.stringify({ text, model_id: 'eleven_v4_turbo' }),
    });
    if (!eleven.ok) throw new NarrationError('ElevenLabs could not generate audio. Check its quota, voice access and configuration.', eleven.status === 429 || eleven.status === 401 ? 429 : 502);
    const bytes = Buffer.from(await eleven.arrayBuffer());
    if (!bytes.length || bytes.length > 8_000_000) throw new NarrationError('Audio was empty or too large.');
    return { bytes, mime: 'audio/mpeg' };
  }
  if (!google.ok) throw new NarrationError('Google narration failed. Check model access and configuration. No fallback was attempted.');
  const data = await google.json();
  const audio = (data.steps || []).filter((step: {type: string}) => step.type === 'model_output')
    .flatMap((step: {content?: {type: string; data?: string; mime_type?: string}[]}) => step.content || [])
    .filter((part: {type: string}) => part.type === 'audio');
  if (audio.length !== 1 || !audio[0].data || !['audio/wav', 'audio/mpeg'].includes(audio[0].mime_type))
    throw new NarrationError('Google did not return one complete supported audio file.');
  const bytes = Buffer.from(audio[0].data, 'base64');
  if (!bytes.length || bytes.length > 8_000_000) throw new NarrationError('Audio was empty or too large.');
  return { bytes, mime: audio[0].mime_type as string };
}
