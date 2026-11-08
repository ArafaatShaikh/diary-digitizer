"use client";
import { useEffect, useRef, useState } from 'react';
import catalogue from '@/lib/voice-catalogue.json';
const languageNames = new Intl.DisplayNames(['en'], {type:'language'});
type Page = { id: string; title: string; corrected_transcription: string; page_number: number | null };
export default function DiaryAudio({ pages, token }: { pages: Page[]; token: string }) {
  const [selection, setSelection] = useState('all');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');
  const [position, setPosition] = useState({ page: 0, chunk: 0, total: 1 });
  const [speed, setSpeed] = useState(1);
  const [language, setLanguage] = useState('auto');
  const [languageConfirmed, setLanguageConfirmed] = useState(false);
  const [detecting, setDetecting] = useState(true);
  const [languageUncertain, setLanguageUncertain] = useState(true);
  const [showLanguages, setShowLanguages] = useState(false);
  const [languageInfo, setLanguageInfo] = useState('Detecting the first page’s language…');
  const [spokenText, setSpokenText] = useState('');
  const audio = useRef<HTMLAudioElement>(null);
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const queue = (selection === 'all' ? pages : pages.filter(p => p.id === selection)).filter(p => p.corrected_transcription.trim());
  const firstPage = queue[0];
  useEffect(() => {
    if (!firstPage) return;
    const controller = new AbortController();
    fetch('/api/narrate', {method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},signal:controller.signal,
      body:JSON.stringify({action:'detect',entryId:firstPage.id,language})})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error('Detection unavailable');return data;})
      .then(data=>{
        if(controller.signal.aborted)return;
        const codes = [...new Set<string>(data.sections.map((part:{language:string|null})=>part.language).filter(Boolean))];
        const names = codes.map(code=>languageNames.of(code)||code).join(' + ');
        setDetecting(false); setLanguageUncertain(Boolean(data.uncertain));
        setLanguageInfo(data.uncertain ? 'Some text is too short or ambiguous to detect. Choose its language below.' : `${names} detected. Is this correct for your writing? Following pages are detected as they play.`);
      }).catch(()=>{if(!controller.signal.aborted){setDetecting(false);setLanguageUncertain(true);setShowLanguages(true);setLanguageInfo('Language preview is unavailable. Choose the language of your writing below.');}});
    return ()=>controller.abort();
  },[firstPage,token,language]);
  useEffect(() => () => { generation.current++; pending.current?.abort(); }, []);
  function stop() {
    generation.current++;
    pending.current?.abort();
    audio.current?.pause();
    setUrl(''); setSpokenText(''); setBusy(false); setMessage(''); setPosition({page:0,chunk:0,total:1});
  }
  async function load(pageIndex: number, chunk: number) {
    if (busy || !consent || !languageConfirmed) return;
    const page = queue[pageIndex];
    if (!page) return;
    const run = ++generation.current;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setUrl(''); setMessage('Opening saved audio or generating this section…');
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(page.corrected_transcription));
      const textHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
      const response = await fetch('/api/narrate', { method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        signal:controller.signal, body:JSON.stringify({entryId:page.id,chunk,textHash,consent:true,language}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not open audio.');
      if (generation.current !== run) return;
      setPosition({page:pageIndex,chunk,total:data.chunks}); setSpokenText(data.text); setUrl(data.url);
      setLanguageInfo(`${languageNames.of(data.language) || data.language} · Noor`);
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
<header className="audio-edition"><div><span className="eyebrow">THE AUDIO EDITION</span><h2>Let Noor read to you.</h2></div><span className="narrator-badge">Noor · multilingual</span></header>
    <p className="small">Listen to your saved writing in page order. Interface labels and buttons are not included in the narration.</p>
    <label>What would you like to hear?<select value={selection} disabled={busy || Boolean(url)} onChange={e=>{stop();setDetecting(true);setSelection(e.target.value);setConsent(false);setLanguageConfirmed(false);}}>
      <option value="all">All saved pages in this diary ({pages.length})</option>
      {pages.map((p,i)=><option key={p.id} value={p.id}>Page {p.page_number || i+1} — {p.title || 'Untitled'}</option>)}
    </select></label>
    <p className="narration-note" role="status">{languageInfo}</p>
    <div className="row"><button type="button" className="secondary" disabled={detecting || languageUncertain || languageConfirmed || busy || Boolean(url)} onClick={()=>setLanguageConfirmed(true)}>{languageConfirmed ? 'Language confirmed' : 'Yes, this is correct'}</button><button type="button" className="secondary" disabled={busy || Boolean(url)} onClick={()=>{setLanguageConfirmed(false);setShowLanguages(true);}}>Choose a different language</button></div>
    <details open={showLanguages} onToggle={event=>setShowLanguages(event.currentTarget.open)}><summary>Language settings</summary>
      <label>Reading language<select value={language} disabled={busy || Boolean(url)} onChange={e=>{setDetecting(true);setLanguage(e.target.value);setConsent(false);setLanguageConfirmed(false);setLanguageInfo('Checking language…');}}>
        <option value="auto">Detect automatically</option>
        {[...catalogue].sort((a,b)=>(languageNames.of(a.language)||a.language).localeCompare(languageNames.of(b.language)||b.language)).map(item=><option key={item.language} value={item.language}>{languageNames.of(item.language)||item.language}</option>)}
      </select></label>
      <p className="small">Noor is the narrator name in every language, using a female voice matched to the text. Detection runs locally on the server, without AI tokens. Short or ambiguous text may need a language choice. Languages change between detected sections; mixed languages within one sentence may not be read correctly.</p>
    </details>
    <label className="audio-consent"><input type="checkbox" checked={consent} disabled={busy || Boolean(url)} onChange={e=>setConsent(e.target.checked)}/><span>I agree to send the selected diary text to Microsoft’s online speech service for narration. Generated audio is stored privately in my account.</span></label>
    <div className="row"><button type="button" disabled={!consent || !languageConfirmed || detecting || busy || !queue.length || Boolean(url)} onClick={()=>void load(0,0)}>{busy?'Preparing audio…':'Listen to the writing'}</button>
    <button type="button" className="secondary" onClick={stop}>Stop / change selection</button>
    <label>Speed<select value={speed} onChange={e=>{const rate=Number(e.target.value);setSpeed(rate);if(audio.current)audio.current.playbackRate=rate;}}>{[0.75,1,1.25,1.5].map(n=><option key={n} value={n}>{n}×</option>)}</select></label></div>
    {url && <audio ref={audio} controls autoPlay src={url} onLoadedMetadata={()=>{if(audio.current)audio.current.playbackRate=speed;}} onEnded={next} onError={()=>setMessage('Playback failed. Stop and reopen this section to refresh its audio link.')} />}
    <p className="small" role="status">{message}</p>
    {spokenText && <details><summary>Text being narrated</summary><div className="narration-text">{spokenText}</div></details>}
    <details><summary>Listening limits and privacy</summary><p className="small">Up to 10 new sections per account and 50 across the app per UTC day, including failed attempts. Noor automatically selects a female voice for the detected language. A chosen language overrides detection. Background playback depends on your device. Audio may contain pronunciation errors.</p>
    <p className="small">Voice generation: Microsoft Edge online speech, through the community edge-tts library. No Google or ElevenLabs tokens are used for audio.</p></details>
  </section>;
}
