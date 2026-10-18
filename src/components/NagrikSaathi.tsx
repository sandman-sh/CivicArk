import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bot, Mic, Send, Settings2, Volume2, X } from 'lucide-react';
import { fetchDefectsFromArkiv, fetchTendersFromArkiv, getTiramisuNetworkInfo, createTenderOnArkiv } from '../lib/arkiv';
import type { UserSession } from '../types/civic';

type Message = { role: 'user' | 'assistant'; content: string };

const closedAudioContexts = new WeakSet<AudioContext>();
const closeAudioContextOnce = (audio: AudioContext) => {
  if (closedAudioContexts.has(audio) || audio.state === 'closed') return;
  closedAudioContexts.add(audio);
  void audio.close().catch(() => {});
};

const SYSTEM = `You are Nagrik Saathi, CivicArk's helpful multilingual civic infrastructure assistant. You understand English, Hindi, Hinglish, Marathi, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Punjabi, Odia and Urdu. Reply in the user's selected language. Explain Arkiv actions before requesting wallet confirmation. Never invent transaction hashes or claim a write succeeded without real Arkiv evidence. Keep private keys and secrets out of chat.`;
const SHARED_TOOLS = [
  { type: 'function', function: { name: 'search_tenders', description: 'Search live public CivicArk tenders by ward or text.', parameters: { type: 'object', properties: { ward: { type: 'string' }, query: { type: 'string' } } } } },
  { type: 'function', function: { name: 'search_defects', description: 'Search live public defect challenges by tender or severity.', parameters: { type: 'object', properties: { tenderId: { type: 'string' }, severity: { type: 'string' } } } } },
  { type: 'function', function: { name: 'network_status', description: 'Get current Arkiv Tiramisu block and RPC latency.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'navigate_workspace', description: 'Open an available workspace page for the current role.', parameters: { type: 'object', required: ['page'], properties: { page: { type: 'string', enum: ['overview','work','reports','operations','audit','areas','map','activity'] } } } } },
  { type: 'function', function: { name: 'refresh_workspace', description: 'Refresh current public ledger, report and network data.', parameters: { type: 'object', properties: {} } } },
];
const ENGINEER_TOOLS = [
  { type: 'function', function: { name: 'create_tender', description: 'Prepare a municipal tender proposal. Never execute silently; the app will ask the user to confirm the wallet transaction. Ask the user for the contractor wallet address.', parameters: { type: 'object', required: ['title', 'ward', 'roadName', 'budgetInr', 'contractorAddress'], properties: { title: { type: 'string' }, ward: { type: 'string' }, roadName: { type: 'string' }, budgetInr: { type: 'number' }, contractorAddress: { type: 'string' }, contractorName: { type: 'string' } } } } },
];
type WorkspacePage = 'overview' | 'work' | 'reports' | 'operations' | 'audit' | 'areas' | 'map' | 'activity';
const ROLE_PAGES: Record<UserSession['role'], WorkspacePage[]> = { citizen: ['overview','work','reports','map','activity'], engineer: ['overview','work','reports','operations','audit','areas','map','activity'], contractor: ['overview','work','reports','operations','map','activity'], auditor: ['overview','work','reports','audit','areas','map','activity'] };

function explainApiError(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return 'The AI gateway returned an unexpected error.';
  const error = value as { message?: unknown; error?: unknown; code?: unknown; metadata?: { provider_name?: unknown } };
  const nested = error.error && error.error !== value ? explainApiError(error.error) : '';
  const message = typeof error.message === 'string' ? error.message : nested;
  const code = typeof error.code === 'string' || typeof error.code === 'number' ? ` (code ${error.code})` : '';
  const provider = typeof error.metadata?.provider_name === 'string' ? ` · provider: ${error.metadata.provider_name}` : '';
  if (message) return `${message}${code}${provider}`;
  try { return JSON.stringify(value); } catch { return 'The AI gateway returned an unexpected error.'; }
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const token = /(\[[^\]]+\]\((?:https?:\/\/)[^)]+\)|\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;
  return text.split(token).filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (link) return <a key={key} href={link[2]} target="_blank" rel="noreferrer noopener">{link[1]}</a>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={key}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={key}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function renderMarkdown(content: string): ReactNode {
  const lines = content.replaceAll('\r\n', '\n').split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;
  const flushParagraph = () => { if (paragraph.length) { blocks.push(<p key={`p-${blocks.length}`}>{paragraph.map((line, index) => <span key={index}>{index > 0 && <br/>}{renderInlineMarkdown(line, `p-${blocks.length}-${index}`)}</span>)}</p>); paragraph = []; } };
  const flushList = () => { if (list) { const Tag = list.ordered ? 'ol' : 'ul'; blocks.push(<Tag key={`list-${blocks.length}`}>{list.items.map((item, index) => <li key={index}>{renderInlineMarkdown(item, `list-${blocks.length}-${index}`)}</li>)}</Tag>); list = null; } };
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) { flushParagraph(); flushList(); if (code) { blocks.push(<pre key={`code-${blocks.length}`}><code>{code.join('\n')}</code></pre>); code = null; } else code = []; continue; }
    if (code) { code.push(line); continue; }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const item = bullet || numbered;
    if (item) { flushParagraph(); const ordered = Boolean(numbered); if (list && list.ordered !== ordered) flushList(); if (!list) list = { ordered, items: [] }; list.items.push(item[1]); continue; }
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/);
    if (heading) { flushParagraph(); flushList(); const Tag = `h${heading[1].length}` as 'h1' | 'h2' | 'h3'; blocks.push(<Tag key={`h-${blocks.length}`}>{renderInlineMarkdown(heading[2], `h-${blocks.length}`)}</Tag>); continue; }
    flushList(); paragraph.push(line);
  }
  if (code) blocks.push(<pre key={`code-${blocks.length}`}><code>{code.join('\n')}</code></pre>);
  flushParagraph(); flushList();
  return blocks;
}

export function NagrikSaathi({ session, onNavigate, onRefresh }: { session: UserSession; onNavigate: (page: WorkspacePage) => void; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [input, setInput] = useState('');
  const [model, setModel] = useState(localStorage.getItem('civicark_ai_model') || 'deepseek/deepseek-chat-v3.1:free');
  const [language, setLanguage] = useState(localStorage.getItem('civicark_ai_language') || 'English');
  const [apiKey, setApiKey] = useState('');
  const [roleProof, setRoleProof] = useState<{ role: UserSession['role']; address: string; expires: number; signature: string } | null>(null);
  const [agentRole, setAgentRole] = useState<UserSession['role']>('citizen');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const voiceStopRef = useRef<() => void>(() => {});
  const messagesPaneRef = useRef<HTMLDivElement>(null);
  const [pendingTender, setPendingTender] = useState<{ title: string; ward: string; roadName: string; budgetInr: number; contractorAddress: string; contractorName: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', content: `Hello! I’m Nagrik Saathi for your ${session.role} workspace. I can search public records, refresh this workspace, and open pages available to this role.` }]);

  useEffect(() => {
    if (localStorage.getItem('civicark_ai_model')) return;
    let active = true;
    void fetch('/api/health').then(response => response.ok ? response.json() : null).then(health => {
      if (active && typeof health?.model === 'string' && health.model.trim()) setModel(health.model);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => () => voiceStopRef.current(), []);

  useEffect(() => {
    const pane = messagesPaneRef.current;
    if (!pane) return;
    const frame = window.requestAnimationFrame(() => pane.scrollTo({ top: pane.scrollHeight, behavior: 'smooth' }));
    return () => window.cancelAnimationFrame(frame);
  }, [messages, busy, pendingTender]);

  const speak = (text: string) => {
    if ('speechSynthesis' in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  };

  const listen = async () => {
    if (recording) return;
    try {
      const tokenResponse = await fetch('/api/stt-token');
      if (!tokenResponse.ok) throw new Error('AssemblyAI token unavailable');
      const { token } = await tokenResponse.json();
      const socket = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&speech_model=u3-rt-pro&token=${encodeURIComponent(token)}`);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const audio = new AudioContext({ sampleRate: 16000 });
      await audio.audioWorklet.addModule('/pcm-processor.js');
      await audio.resume();
      const source = audio.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audio, 'civicark-pcm-processor');
      setRecording(true);
      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        setRecording(false);
        try { stream.getTracks().forEach(track => track.stop()); } catch {}
        closeAudioContextOnce(audio);
      };
      socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === 'Turn' && message.end_of_turn && message.transcript) setInput(message.transcript);
      };
      socket.onerror = cleanup;
      socket.onclose = cleanup;
      worklet.port.onmessage = event => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(event.data);
        }
      };
      source.connect(worklet);
      window.setTimeout(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'Terminate' }));
          socket.close();
        }
        cleanup();
      }, 30000);
      return;
    } catch {
      // Fall back to the browser recognizer for local development without AssemblyAI.
    }
    const SpeechRecognition = (window as Window & { webkitSpeechRecognition?: new () => SpeechRecognition }).webkitSpeechRecognition;
    if (!SpeechRecognition) return setInput('Voice input is not supported in this browser. Use Chrome or Edge.');
    const recognition = new SpeechRecognition();
    recognition.lang = language === 'English' ? 'en-IN' : language === 'Marathi' ? 'mr-IN' : language === 'Tamil' ? 'ta-IN' : language === 'Telugu' ? 'te-IN' : 'hi-IN';
    recognition.onresult = event => setInput(event.results[0][0].transcript);
    recognition.start();
  };

  const startVoiceAgent = async () => {
    if (voiceActive) { voiceStopRef.current(); return; }
    try {
      const { token } = await (await fetch('/api/voice-token')).json();
      if (!token) throw new Error('Voice token unavailable');
      const audio = new AudioContext({ sampleRate: 24000 });
      await audio.audioWorklet.addModule('/pcm-processor.js');
      await audio.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false } });
      const source = audio.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audio, 'civicark-pcm-processor');
      const socket = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${encodeURIComponent(token)}`);
      let ready = false; let playbackTime = audio.currentTime;
      worklet.port.onmessage = event => { if (ready && socket.readyState === WebSocket.OPEN) { const bytes = new Uint8Array(event.data); let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); socket.send(JSON.stringify({ type: 'input.audio', audio: btoa(binary) })); } };
      source.connect(worklet).connect(audio.destination);
      socket.onopen = () => { socket.send(JSON.stringify({ type: 'session.update', session: { system_prompt: `${SYSTEM} Selected language: ${language}.`, greeting: 'Namaste! Main Nagrik Saathi hoon.', output: { sample_rate: 24000 } } })); setVoiceActive(true); };
      socket.onmessage = event => { const msg = JSON.parse(event.data); if (msg.type === 'session.ready') ready = true; if (msg.type === 'transcript.user' && msg.text) setMessages(current => [...current, { role: 'user', content: msg.text }]); if (msg.type === 'transcript.agent' && msg.text) setMessages(current => [...current, { role: 'assistant', content: msg.text }]); if (msg.type === 'reply.audio') { const raw = atob(msg.data); const pcm = new Int16Array(raw.length / 2); for (let i = 0; i < pcm.length; i++) pcm[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8); const buffer = audio.createBuffer(1, pcm.length, 24000); const channel = buffer.getChannelData(0); for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768; const player = audio.createBufferSource(); player.buffer = buffer; player.connect(audio.destination); playbackTime = Math.max(playbackTime, audio.currentTime); player.start(playbackTime); playbackTime += buffer.duration; } };
      let voiceCleanedUp = false;
      const stop = () => { if (voiceCleanedUp) return; voiceCleanedUp = true; if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'session.end' })); socket.close(); stream.getTracks().forEach(track => track.stop()); closeAudioContextOnce(audio); setVoiceActive(false); };
      voiceStopRef.current = stop;
      socket.onclose = () => { if (voiceCleanedUp) return; voiceCleanedUp = true; stream.getTracks().forEach(track => track.stop()); closeAudioContextOnce(audio); setVoiceActive(false); };
      socket.onerror = () => { socket.close(); };
    } catch (error) { setMessages(current => [...current, { role: 'assistant', content: `Live Voice unavailable: ${error instanceof Error ? error.message : 'configure AssemblyAI on the gateway first.'}` }]); }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next); setInput(''); setBusy(true);
    try {
      let proof = roleProof;
      if (session.role !== 'citizen' && session.isMetaMask && (!proof || proof.role !== session.role || proof.address.toLowerCase() !== session.address.toLowerCase() || proof.expires < Date.now() + 15_000)) {
        const expires = Date.now() + 90_000;
        const address = session.address.toLowerCase();
        const message = `CivicArk AI role proof\n${session.role}\n${address}\n${expires}`;
        const signature = await (window as any).ethereum.request({ method: 'personal_sign', params: [message, session.address] });
        proof = { role: session.role, address, expires, signature };
        setRoleProof(proof);
      }
      const roleTools = session.role === 'engineer' ? [...SHARED_TOOLS, ...ENGINEER_TOOLS] : SHARED_TOOLS;
      const response = await fetch('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, apiKey: apiKey || undefined, role: session.role, address: session.address, roleProof: proof && proof.role === session.role ? proof : undefined, tools: roleTools, messages: [{ role: 'system', content: `${SYSTEM}\nSelected language: ${language}. The server authorizes tools for this request; never claim access beyond the tools provided. Public chain records are not private departmental databases.`, }, ...next] }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`AI request failed (${response.status}): ${explainApiError(data.error || data.message || data)}`);
      const assistant = data.choices?.[0]?.message;
      const authorizedRole: UserSession['role'] = ['citizen','engineer','contractor','auditor'].includes(data.authorizedRole) ? data.authorizedRole : 'citizen';
      setAgentRole(authorizedRole);
      const toolCalls = Array.isArray(assistant?.tool_calls) ? assistant.tool_calls.slice(0, 4) : [];
      const toolAnswers: string[] = [];
      for (const call of toolCalls) {
        const name = call?.function?.name;
        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(call?.function?.arguments || '{}');
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Tool arguments must be a JSON object.');
          args = parsed as Record<string, unknown>;
        } catch (error) {
          toolAnswers.push(`Could not run ${name || 'requested action'}: ${error instanceof Error ? error.message : 'invalid arguments'}`);
          continue;
        }
        try {
          if (name === 'navigate_workspace') {
            const page = String(args.page || '') as WorkspacePage;
            if (!ROLE_PAGES[authorizedRole].includes(page)) toolAnswers.push(`This page is not available to the verified ${authorizedRole} agent role.`);
            else { onNavigate(page); toolAnswers.push(`Opened the ${page.replaceAll('_', ' ')} page.`); }
          } else if (name === 'refresh_workspace') {
            onRefresh(); toolAnswers.push('Refreshing the workspace from its connected data sources.');
          } else if (name === 'search_tenders') {
            const ward = typeof args.ward === 'string' ? args.ward : undefined;
            const query = typeof args.query === 'string' ? args.query.toLowerCase() : '';
            const result = await fetchTendersFromArkiv(ward);
            const matches = result.tenders.filter(t => (authorizedRole !== 'contractor' || (session.isMetaMask && t.contractor.toLowerCase() === session.address.toLowerCase())) && (!query || `${t.title} ${t.roadName} ${t.tenderId}`.toLowerCase().includes(query))).slice(0, 8);
            toolAnswers.push(matches.length ? matches.map(t => `${t.tenderId}: ${t.title} — ${t.ward}, ${t.roadName}, ₹${t.budgetInr.toLocaleString('en-IN')}, ${t.status}${authorizedRole === 'engineer' || authorizedRole === 'auditor' ? `, contractor ${t.contractorName}, engineer ${t.engineerName}` : ''}`).join('\n') : authorizedRole === 'contractor' ? 'No public work records are linked to this connected wallet.' : result.source === 'arkiv_chain' ? 'No matching tenders found in the Arkiv ledger.' : 'No matching tenders found in the locally cached on-chain records.');
          } else if (name === 'search_defects') {
            const tenderId = typeof args.tenderId === 'string' ? args.tenderId.toLowerCase() : '';
            const severity = typeof args.severity === 'string' ? args.severity.toLowerCase() : '';
            const defects = await fetchDefectsFromArkiv();
            const matches = defects.filter(d => (!tenderId || d.tenderId.toLowerCase() === tenderId || d.tenderKey.toLowerCase() === tenderId) && (!severity || d.severity.toLowerCase() === severity)).slice(0, 8);
            toolAnswers.push(matches.length ? matches.map(d => `${d.tenderId}: ${d.severity} — ${d.roadName} — ${d.status} — ${d.description}`).join('\n') : 'No matching public defect challenges found in the available Arkiv records.');
          } else if (name === 'network_status') {
            const info = await getTiramisuNetworkInfo();
            toolAnswers.push(info.blockNumber > 0n ? `Arkiv Tiramisu is reachable. Block ${info.blockNumber.toString()}, RPC latency ${info.latencyMs}ms, chain ${info.chainId}.` : `Arkiv Tiramisu did not respond to the RPC check. Chain ${info.chainId}; block and latency are unavailable.`);
          } else if (name === 'create_tender') {
            const proposal = { title: String(args.title || '').trim(), ward: String(args.ward || '').trim(), roadName: String(args.roadName || '').trim(), budgetInr: Number(args.budgetInr), contractorAddress: String(args.contractorAddress || '').trim(), contractorName: String(args.contractorName || 'Contractor').trim() };
            if (!session.isMetaMask || session.role !== 'engineer' || authorizedRole !== 'engineer') toolAnswers.push('Tender publishing requires a wallet authorized in the server-side engineer allowlist. This session is read-only.');
            else if (!/^0x[a-fA-F0-9]{40}$/.test(proposal.contractorAddress) || !Number.isFinite(proposal.budgetInr) || proposal.budgetInr <= 0 || !proposal.title || !proposal.roadName || !proposal.ward) toolAnswers.push('I need a valid contractor wallet, positive budget, title, ward, and road name to prepare a tender.');
            else { setPendingTender(proposal); toolAnswers.push(`Tender proposal prepared for ${proposal.roadName} in ${proposal.ward}. Review it in the confirmation card before signing.`); }
          } else toolAnswers.push(`The requested tool “${String(name || 'unknown')}” is not available for this role.`);
        } catch (error) {
          toolAnswers.push(`${String(name || 'Requested action')} failed: ${error instanceof Error ? error.message : 'Unexpected tool error.'}`);
        }
      }
      let answer = [typeof assistant?.content === 'string' ? assistant.content : '', ...toolAnswers].filter(Boolean).join('\n\n');
      if (!answer) answer = 'I could not understand that request.';
      if (session.role !== 'citizen' && authorizedRole === 'citizen') answer = `This session is a read-only role preview. The agent is restricted to public tools because this wallet is not server-authorized for ${session.role} access.\n\n${answer}`;
      setMessages(current => [...current, { role: 'assistant', content: answer }]);
      speak(answer);
    } catch (error) {
      setMessages(current => [...current, { role: 'assistant', content: `AI connection issue: ${error instanceof Error ? error.message : explainApiError(error)}.` }]);
    } finally { setBusy(false); }
  };

  const confirmTender = async () => {
    if (!pendingTender) return;
    setBusy(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      const result = await createTenderOnArkiv({
        tenderId: `BMC-2026-${pendingTender.ward.replace(/[^A-Z]/g, '')}-AI-${Date.now()}`,
        title: pendingTender.title, city: 'Mumbai', ward: pendingTender.ward, wardName: pendingTender.ward, roadName: pendingTender.roadName,
        category: 'roadwork', status: 'warranty_active', budgetInr: pendingTender.budgetInr, contractor: pendingTender.contractorAddress, contractorName: pendingTender.contractorName, engineer: session.address, engineerName: session.displayName,
        dlpYears: 3, dlpExpiryTimestamp: now + 86400 * 365 * 3, defectCount: 0, awardedAt: now,
        specs: { material: '', thicknessMm: 0, coreSampleLabCid: '', labAccreditation: '' },
        milestones: [{ phase: 'Tender sanctioned by Nagrik Saathi', signedBy: session.address, role: session.role, timestamp: now, status: 'done', notes: 'Explicit user-confirmed Arkiv write.' }],
      }, session);
      setMessages(current => [...current, { role: 'assistant', content: `Tender published on Arkiv. Entity: ${result.entityKey}\nTransaction: ${result.txHash}` }]);
      setPendingTender(null);
    } catch (error) {
      setMessages(current => [...current, { role: 'assistant', content: `Arkiv write failed and was not treated as successful: ${error instanceof Error ? error.message : 'unknown error'}` }]);
    } finally { setBusy(false); }
  };

  return <>
    <button className="saathi-launcher" onClick={() => setOpen(true)} aria-label="Open Nagrik Saathi"><Bot size={21} /><span>Nagrik Saathi</span></button>
    {open && <aside className="saathi-panel">
      <header><div><Bot size={18} /><strong>Nagrik Saathi</strong><small>{agentRole === 'citizen' ? 'Public read-only tools' : `${agentRole} tools · wallet verified`}</small></div><div className="saathi-actions"><button className={voiceActive ? 'saathi-recording' : ''} onClick={startVoiceAgent} aria-label="Start live voice"><Mic size={16} /></button><button onClick={() => setSettings(!settings)} aria-label="AI settings"><Settings2 size={16} /></button><button onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button></div></header>
      {settings && <section className="saathi-settings"><label>Language<select value={language} onChange={e => { setLanguage(e.target.value); localStorage.setItem('civicark_ai_language', e.target.value); }}><option>Hinglish</option><option>English</option><option>Hindi</option><option>Marathi</option><option>Bengali</option><option>Tamil</option><option>Telugu</option><option>Gujarati</option><option>Kannada</option><option>Malayalam</option><option>Punjabi</option><option>Odia</option><option>Urdu</option></select></label><label>Model<input value={model} onChange={e => { setModel(e.target.value); localStorage.setItem('civicark_ai_model', e.target.value); }} /></label><button type="button" className="btn btn-ghost btn-sm" onClick={() => { localStorage.removeItem('civicark_ai_model'); void fetch('/api/health').then(response => response.json()).then(health => { if (typeof health.model === 'string') setModel(health.model); }).catch(() => setModel('deepseek/deepseek-chat-v3.1:free')); }}>Use gateway default model</button><label>OpenRouter API key <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-or-… · sent for this request" /></label><small>Use an OpenRouter key for the configured gateway. A key is sent only with this request, not stored in the browser. Public chain records are visible to every role.</small></section>}
      <div className="saathi-messages" ref={messagesPaneRef}>{messages.map((message, index) => <div className={`saathi-message ${message.role}`} key={`${message.role}-${index}`}><div className="saathi-message-content">{renderMarkdown(message.content)}</div>{message.role === 'assistant' && <button onClick={() => speak(message.content)} aria-label="Read aloud"><Volume2 size={13} /></button>}</div>)}{pendingTender && <div className="saathi-confirm"><strong>Confirm Arkiv write</strong><span>{pendingTender.title} · {pendingTender.ward} · ₹{pendingTender.budgetInr.toLocaleString('en-IN')} · Contractor {pendingTender.contractorAddress}</span><button onClick={confirmTender} disabled={busy}>Confirm Arkiv Write</button><button onClick={() => setPendingTender(null)} disabled={busy}>Cancel</button></div>}{busy && <div className="saathi-message assistant">Thinking…</div>}</div>
      <div className="saathi-input"><button className={recording ? 'saathi-recording' : ''} onClick={listen} aria-label="Voice input"><Mic size={17} /></button><input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder={recording ? 'Listening…' : 'Ask in Hindi, English or Hinglish…'} /><button onClick={send} aria-label="Send"><Send size={17} /></button></div>
    </aside>}
  </>;
}

type SpeechRecognition = { lang: string; onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; start: () => void };
