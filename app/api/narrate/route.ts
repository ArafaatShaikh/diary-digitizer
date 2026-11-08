import { createHash } from 'node:crypto';
import { requireUser, apiError } from '@/lib/server-auth';
import { readJson, RequestError } from '@/lib/request-validation';
import { narrationSegments, generateNarration, detectNarration, NarrationError } from '@/lib/narration';
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const { db, user } = await requireUser(request);
    const body = await readJson(request, 2000) as Record<string, unknown>;
    const detectionOnly = body?.action === 'detect';
    if (!body || typeof body.entryId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.entryId) ||
      (!detectionOnly && (!Number.isInteger(body.chunk) || Number(body.chunk) < 0 || body.consent !== true || typeof body.textHash !== 'string')) ||
      (body.language !== undefined && typeof body.language !== 'string'))
      throw new RequestError('Select a saved page and confirm audio processing.');
    const { data: entry, error } = await db.from('entries').select('id, corrected_transcription').eq('id', body.entryId).eq('user_id', user.id).maybeSingle();
    if (error || !entry) throw new RequestError('This page is unavailable.', 404);
    const text = entry.corrected_transcription || '';
    if (!text.trim() || text.length > 100000) throw new RequestError('This page is empty or too long for narration.');
    const chunks = narrationSegments(text);
    const language = typeof body.language === 'string' ? body.language : 'auto';
    const resolved = chunks.map(part => detectNarration(part, language) || detectNarration(text, language));
    if (detectionOnly) return Response.json({ sections: resolved.map((item,index) => ({ index, language:item?.language || null, voice:item?.voice || null })), uncertain: resolved.some(item=>!item) }, {headers:{'Cache-Control':'no-store'}});
    const hash = createHash('sha256').update(text).digest('hex');
    if (body.textHash !== hash) throw new RequestError('This page changed. Reload before listening.', 409);
    const chunk = Number(body.chunk);
    if (chunk >= chunks.length) throw new RequestError('This audio section does not exist.');
    const detected = resolved[chunk];
    if (!detected) throw new RequestError('The language is uncertain or not detected automatically. Choose its language before listening.', 422);
    const voice = detected.voice;
    const version = createHash('sha256').update(`edge-v2:${hash}:${voice}:-12%:-2Hz`).digest('hex');
    const key = `${entry.id}/${version}/${chunk}`;
    const path = `${user.id}/${key}.audio`;
    const bucket = db.storage.from('diary-audio');
    let signed = await bucket.createSignedUrl(path, 600);
    if (signed.error) {
      const allowance = await db.rpc('reserve_narration', { p_cache_key: key });
      if (allowance.error) throw new RequestError('Audio setup is incomplete. Apply the narration migration.', 503);
      if (!allowance.data) throw new RequestError('Audio allowance reached or this section is processing. Wait two minutes before retrying; daily limits reset at midnight UTC.', 429);
      const result = await generateNarration(chunks[chunk], request.headers.get('authorization') || '', voice);
      const upload = await bucket.upload(path, result.bytes, { contentType: result.mime, upsert: false });
      if (upload.error) throw new RequestError('Could not save generated audio. Please try again later.', 503);
      signed = await bucket.createSignedUrl(path, 600);
    }
    if (signed.error || !signed.data) throw new RequestError('Could not open saved audio.', 503);
    return Response.json({ url: signed.data.signedUrl, chunks: chunks.length, text: chunks[chunk], voice, language:detected.language }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof NarrationError) return Response.json({error:error.message},{status:error.status,headers:{'Cache-Control':'no-store'}});
    if (error instanceof RequestError) return apiError(error);
    return Response.json({error:'Audio generation failed. Your diary is unchanged; no automatic retry was made.'},{status:502,headers:{'Cache-Control':'no-store'}});
  }
}
