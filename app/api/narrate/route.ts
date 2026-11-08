import { createHash } from 'node:crypto';
import { requireUser, apiError } from '@/lib/server-auth';
import { readJson, RequestError } from '@/lib/request-validation';
import { narrationChunks, generateNarration, NarrationError } from '@/lib/narration';
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser(request);
    const body = await readJson(request, 2000) as Record<string, unknown>;
    if (!body || typeof body.entryId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.entryId) ||
      !Number.isInteger(body.chunk) || Number(body.chunk) < 0 || body.consent !== true || typeof body.textHash !== 'string')
      throw new RequestError('Select a saved page and confirm audio processing.');
    const { data: entry, error } = await db.from('entries').select('id, corrected_transcription').eq('id', body.entryId).eq('user_id', user.id).maybeSingle();
    if (error || !entry) throw new RequestError('This page is unavailable.', 404);
    const text = entry.corrected_transcription || '';
    if (!text.trim() || text.length > 100000) throw new RequestError('This page is empty or too long for narration.');
    const hash = createHash('sha256').update(text).digest('hex');
    if (body.textHash !== hash) throw new RequestError('This page changed. Reload before listening.', 409);
    const chunks = narrationChunks(text);
    const chunk = Number(body.chunk);
    if (chunk >= chunks.length) throw new RequestError('This audio section does not exist.');
    const version = createHash('sha256').update(`v1:${hash}:gemini-3.8-flash-lite-tts:Kore:eleven_v4_turbo:${process.env.ELEVENLABS_VOICE_ID || ''}`).digest('hex');
    const key = `${entry.id}/${version}/${chunk}`;
    const path = `${user.id}/${key}.audio`;
    const bucket = db.storage.from('diary-audio');
    let signed = await bucket.createSignedUrl(path, 600);
    if (signed.error) {
      const allowance = await db.rpc('reserve_narration', { p_cache_key: key });
      if (allowance.error) throw new RequestError('Audio setup is incomplete. Apply the narration migration.', 503);
      if (!allowance.data) throw new RequestError('Audio allowance reached or this section is processing. Wait two minutes before retrying; daily limits reset at midnight UTC.', 429);
      const result = await generateNarration(chunks[chunk]);
      const upload = await bucket.upload(path, result.bytes, { contentType: result.mime, upsert: false });
      if (upload.error) throw new RequestError('Could not save generated audio. Please try again later.', 503);
      signed = await bucket.createSignedUrl(path, 600);
    }
    if (signed.error || !signed.data) throw new RequestError('Could not open saved audio.', 503);
    return Response.json({ url: signed.data.signedUrl, chunks: chunks.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof NarrationError) return Response.json({error:error.message},{status:error.status,headers:{'Cache-Control':'no-store'}});
    if (error instanceof RequestError) return apiError(error);
    return Response.json({error:'Audio generation failed. Your diary is unchanged; no automatic retry was made.'},{status:502,headers:{'Cache-Control':'no-store'}});
  }
}
