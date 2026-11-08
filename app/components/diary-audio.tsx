"use client";
import { useEffect, useRef, useState } from 'react';
type Page = { id: string; title: string; corrected_transcription: string; page_number: number | null };
export default function DiaryAudio({ pages, token }: { pages: Page[]; token: string }) {
  const [selection, setSelection] = useState('all');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');
  const [position, setPosition] = useState({ page: 0, chunk: 0, total: 1 });
  const [speed, setSpeed] = useState(1);
  const audio = useRef<HTMLAudioElement>(null);
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const queue = (selection === 'all' ? pages : pages.filter(p => p.id === selection)).filter(p => p.corrected_transcription.trim());
  useEffect(() => () => { generation.current++; pending.current?.abort(); }, []);
  function stop() {
    generation.current++;
    pending.current?.abort();
    audio.current?.pause();
    setUrl(''); setBusy(false); setMessage(''); setPosition({page:0,chunk:0,total:1});
  }
  async function load(pageIndex: number, chunk: number) {
    if (busy || !consent) return;
    const page = queue[pageIndex];
    if (!page) return;
    const run = ++generation.current;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setUrl(''); setMessage('Opening saved audio or generating this section…');
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(page.corrected_transcription));
      const textHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
      const response = await fetch('/api/narrate', { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        signal:controller.signal, body:JSON.stringify({entryId:page.id,chunk,textHash,consent:true}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not open audio.');
      if (generation.current !== run) return;
      setPosition({page:pageIndex,chunk,total:data.chunks}); setUrl(data.url);
      setMessage(`Page ${page.page_number || pageIndex+1}: ${page.title || 'Untitled'} · section ${chunk+1} of ${data.chunks}. Press play if playback does not start.`);
    } catch (error) {
      if (generation.current === run) setMessage(error instanceof Error ? error.message : 'Audio failed.');
    } finally { if (generation.current === run) setBusy(false); }
  }
  function next() {
    if (position.chunk + 1 < position.total) void load(position.page, position.chunk+1);
    else if (position.page + 1 < queue.length) void load(position.page+1,0);
    else setMessage('Finished listening.');
  }
  return <section className="panel diary-audio" aria-label="Listen to your diary">
    <h2>Listen to your diary</h2>
    <p className="small">Saved, reviewed text is read in page order. New audio is generated only when you select Listen, then as each section ends. Saved audio is reused.</p>
    <label>What would you like to hear?<select value={selection} disabled={busy || Boolean(url)} onChange={e=>{stop();setSelection(e.target.value);setConsent(false);}}>
      <option value="all">All saved pages in this diary ({pages.length})</option>
      {pages.map((p,i)=><option key={p.id} value={p.id}>Page {p.page_number || i+1} — {p.title || 'Untitled'}</option>)}
    </select></label>
    <label className="row"><input type="checkbox" checked={consent} disabled={busy || Boolean(url)} onChange={e=>setConsent(e.target.checked)}/><span>I agree to send the selected diary text to Google for speech generation, and to ElevenLabs if Google reports a quota limit. Generated audio is stored privately in my account.</span></label>
    <div className="row"><button type="button" disabled={!consent || busy || !queue.length || Boolean(url)} onClick={()=>void load(0,0)}>{busy?'Preparing audio…':'Listen'}</button>
    <button type="button" className="secondary" onClick={stop}>Stop / change selection</button>
    <label>Speed<select value={speed} onChange={e=>{const rate=Number(e.target.value);setSpeed(rate);if(audio.current)audio.current.playbackRate=rate;}}>{[0.75,1,1.25,1.5].map(n=><option key={n} value={n}>{n}×</option>)}</select></label></div>
    {url && <audio ref={audio} controls autoPlay src={url} onLoadedMetadata={()=>{if(audio.current)audio.current.playbackRate=speed;}} onEnded={next} onError={()=>setMessage('Playback failed. Stop and reopen this section to refresh its audio link.')} />}
    <p className="small" role="status">{message}</p>
    <p className="small">Up to 10 new sections per account and 50 across the app per UTC day, including failed attempts. Narrator voices may change on fallback. Background playback depends on your device. Audio may contain pronunciation errors.</p>
    <p className="small">Voice generation: Google / <a href="https://elevenlabs.io" target="_blank" rel="noopener noreferrer">ElevenLabs (elevenlabs.io)</a>. Personal, non-commercial use.</p>
  </section>;
}
