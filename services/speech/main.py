"""Private speech service. Never log text, tokens or provider responses."""
import asyncio
import json
import os
import edge_tts
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import Response, JSONResponse

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
MAX_BYTES = 2_000_000

async def synthesise(text: str, voice: str) -> bytes:
    audio = bytearray()
    communicator = edge_tts.Communicate(text, voice, rate='-12%', pitch='-2Hz', connect_timeout=10, receive_timeout=20)
    async for packet in communicator.stream():
        if packet['type'] == 'audio':
            audio.extend(packet['data'])
            if len(audio) > MAX_BYTES:
                raise ValueError('Audio too large')
    if not audio:
        raise ValueError('Empty audio')
    return bytes(audio)

@app.post('/synthesise')
async def narrate(request: Request):
    authorization = request.headers.get('authorization', '')
    if not authorization.startswith('Bearer '):
        return JSONResponse({'error': 'Sign in required.'}, status_code=401)
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL', '').rstrip('/')
    key = os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    if not url or not key:
        return JSONResponse({'error': 'Speech service is not configured.'}, status_code=503)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            user = await client.get(url + '/auth/v1/user', headers={'Authorization': authorization, 'apikey': key})
        if user.status_code != 200:
            return JSONResponse({'error': 'Session expired.'}, status_code=401)
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 12000:
                return JSONResponse({'error': 'Request too large.'}, status_code=413)
        data = json.loads(raw)
        text = data.get('text')
        voice = data.get('voice')
        if not isinstance(text, str) or not text.strip() or len(text) > 800 or voice not in ('en-GB-SoniaNeural', 'en-GB-RyanNeural', 'bn-BD-NabanitaNeural'):
            return JSONResponse({'error': 'Invalid narration request.'}, status_code=400)
        audio = await asyncio.wait_for(synthesise(text, voice), timeout=45)
        return Response(audio, media_type='audio/mpeg', headers={'Cache-Control': 'no-store'})
    except (ValueError, TypeError, AttributeError, json.JSONDecodeError):
        return JSONResponse({'error': 'Invalid or incomplete audio request.'}, status_code=400)
    except Exception:
        return JSONResponse({'error': 'Narration is unavailable. No automatic retry was made.'}, status_code=502)
