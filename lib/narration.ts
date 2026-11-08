import { detectAll } from 'tinyld';
import catalogue from './voice-catalogue.json';
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
export function narrationSegments(text: string) {
  return text.split(/\n\s*\n/u).filter(part => part.trim()).flatMap(narrationChunks);
}
export class NarrationError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}
export const allowedNarrators = catalogue.map(item => item.voice);
export function detectNarration(text: string, language = 'auto') {
  if (language !== 'auto') {
    const chosen = catalogue.find(item => item.language === language);
    return chosen ? { ...chosen, automatic: false } : null;
  }
  if ((text.match(/\p{L}/gu) || []).length < 20) return null;
  const ranked = detectAll(text);
  const best = ranked[0];
  if (!best || best.accuracy < 0.7 || best.accuracy - (ranked[1]?.accuracy || 0) < 0.2) return null;
  const aliases: Record<string,string> = { no:'nb', tl:'fil', cmn:'zh', pes:'fa', lvs:'lv' };
  const code = aliases[best.lang] || best.lang;
  const chosen = catalogue.find(item => item.language === code);
  return chosen ? { ...chosen, automatic: true } : null;
}
export function narrationVoice(text: string) { return detectNarration(text)?.voice || null; }
export async function generateNarration(text: string, authorization: string, voice: string, env = process.env, send = fetch) {
  if (!env.SPEECH_SERVICE_URL) throw new NarrationError('The Edge speech service is not configured.', 503);
  const response = await send(new URL('synthesise', env.SPEECH_SERVICE_URL.endsWith('/') ? env.SPEECH_SERVICE_URL : env.SPEECH_SERVICE_URL + '/'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization },
    signal: AbortSignal.timeout(50000), body: JSON.stringify({ text, voice }),
  });
  if (!response.ok) throw new NarrationError('Edge narration is temporarily unavailable. Your saved pages are unchanged.', response.status === 429 ? 429 : 502);
  if (!response.headers.get('content-type')?.startsWith('audio/mpeg')) throw new NarrationError('Speech service did not return MP3 audio.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 2_000_000) throw new NarrationError('Audio was empty or too large.');
  return { bytes, mime: 'audio/mpeg' };
}
