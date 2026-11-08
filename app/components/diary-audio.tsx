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
  const [voice, setVoice] = useState('auto');
  const [spokenText, setSpokenText] = useState('');
  const voices = [
    ['en-GB-SoniaNeural','Sonia · English · female','english-sonia'],
    ['en-GB-RyanNeural','Ryan · English · male','english-ryan'],
  ];
  const sample = voices.find(v=>v[0]===voice)?.[2] || 'english-sonia';
  const audio = useRef<HTMLAudioElement>(null);
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const queue = (selection === 'all' ? pages : pages.filter(p => p.id === selection)).filter(p => p.corrected_transcription.trim());
  useEffect(() => () => { generation.current++; pending.current?.abort(); }, []);
  function stop() {
    generation.current++;
    pending.current?.abort();
    audio.current?.pause();
    setUrl(''); setSpokenText(''); setBusy(false); setMessage(''); setPosition({page:0,chunk:0,total:1});
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
        signal:controller.signal, body:JSON.stringify({entryId:page.id,chunk,textHash,consent:true,voice}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not open audio.');
      if (generation.current !== run) return;
      setPosition({page:pageIndex,chunk,total:data.chunks}); setSpokenText(data.text); setUrl(data.url);
      setMessage('Narration ready. Use the audio controls to play or pause.');
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
<header className="audio-edition"><div><span className="eyebrow">THE AUDIO EDITION</span><h2>Let your words be read.</h2></div><span className="narrator-badge">Sonia & Ryan</span></header>
    <p className="small">Listen to your saved writing in page order. Interface labels and buttons are not included in the narration.</p>
    <label>What would you like to hear?<select value={selection} disabled={busy || Boolean(url)} onChange={e=>{stop();setSelection(e.target.value);setConsent(false);}}>
      <option value="all">All saved pages in this diary ({pages.length})</option>
      {pages.map((p,i)=><option key={p.id} value={p.id}>Page {p.page_number || i+1} — {p.title || 'Untitled'}</option>)}
    </select></label>
    <details><summary>Choose a voice · listen to samples</summary>
      <label>Narrator<select value={voice} disabled={busy || Boolean(url)} onChange={e=>{setVoice(e.target.value);setConsent(false);}}><option value="auto">Automatic · Sonia for English, Nabanita for Bengali</option>{voices.map(v=><option key={v[0]} value={v[0]}>{v[1]}</option>)}</select></label>
      <p className="small">Fictional sample, with the same slower reading pace. Playing samples uses no generation allowance. Stop diary playback before listening to a sample.</p>
      <audio key={sample} controls preload="none" src={`/voices/${sample}.mp3`} aria-label="Narrator sample" onPlay={()=>audio.current?.pause()} />
    </details>
    <label className="audio-consent"><input type="checkbox" checked={consent} disabled={busy || Boolean(url)} onChange={e=>setConsent(e.target.checked)}/><span>I agree to send the selected diary text to Microsoft’s online speech service for narration. Generated audio is stored privately in my account.</span></label>
    <div className="row"><button type="button" disabled={!consent || busy || !queue.length || Boolean(url)} onClick={()=>void load(0,0)}>{busy?'Preparing audio…':'Listen to the writing'}</button>
    <button type="button" className="secondary" onClick={stop}>Stop / change selection</button>
    <label>Speed<select value={speed} onChange={e=>{const rate=Number(e.target.value);setSpeed(rate);if(audio.current)audio.current.playbackRate=rate;}}>{[0.75,1,1.25,1.5].map(n=><option key={n} value={n}>{n}×</option>)}</select></label></div>
    {url && <audio ref={audio} controls autoPlay src={url} onLoadedMetadata={()=>{if(audio.current)audio.current.playbackRate=speed;}} onEnded={next} onError={()=>setMessage('Playback failed. Stop and reopen this section to refresh its audio link.')} />}
    <p className="small" role="status">{message}</p>
    {spokenText && <details><summary>Text being narrated</summary><div className="narration-text">{spokenText}</div></details>}
    <details><summary>Listening limits and privacy</summary><p className="small">Up to 10 new sections per account and 50 across the app per UTC day, including failed attempts. Automatic narration uses Sonia for English and Nabanita for pages containing Bengali. A selected narrator overrides this. Background playback depends on your device. Audio may contain pronunciation errors.</p>
    <p className="small">Voice generation: Microsoft Edge online speech, through the community edge-tts library. No Google or ElevenLabs tokens are used for audio.</p></details>
  </section>;
}
