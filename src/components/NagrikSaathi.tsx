import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bot, ImagePlus, Mic, Send, Settings2, Volume2, X } from 'lucide-react';
import { fetchDefectsFromArkiv, fetchTendersFromArkiv, getTiramisuNetworkInfo, submitDefectChallenge, switchToTiramisuNetwork, TIRAMISU_CHAIN_ID } from '../lib/arkiv';
import type { DefectChallenge, DefectSeverity, UserSession } from '../types/civic';

type Message = { role: 'user' | 'assistant'; content: string };

const closedAudioContexts = new WeakSet<AudioContext>();
const closeAudioContextOnce = (audio: AudioContext) => {
  if (closedAudioContexts.has(audio) || audio.state === 'closed') return;
  closedAudioContexts.add(audio);
  void audio.close().catch(() => {});
};

const SYSTEM = `You are Nagrik Saathi, CivicArk's helpful multilingual civic assistant for Mumbai residents. Reply in the user's selected language. Your access is citizen-level in every workspace. You can search public tenders and defect reports, check network status, refresh data, open citizen pages, and help prepare a pothole/defect report. For reports, collect one exact road/landmark and locality, BMC ward if known, a concise description, and severity. If the user gives several localities without one exact spot, ask which one; do not search tenders just because they mention a place. Never claim the app cannot submit reports. Call prepare_defect_report only when you have enough details; if details are missing, ask for them instead. A prepared report is only a draft: clearly say it has not been submitted, and wait for the user to press the in-app confirmation button before any wallet transaction. Photos can be attached with the image button. Never invent report ids, transaction hashes, map locations, or successful writes. Public chain metadata can identify the signing wallet even when display anonymity is selected. Keep private keys and secrets out of chat.`;
const SHARED_TOOLS = [
  { type: 'function', function: { name: 'search_tenders', description: 'Search live public CivicArk tenders by ward or text.', parameters: { type: 'object', properties: { ward: { type: 'string' }, query: { type: 'string' } } } } },
  { type: 'function', function: { name: 'search_defects', description: 'Search live public defect challenges by tender or severity.', parameters: { type: 'object', properties: { tenderId: { type: 'string' }, severity: { type: 'string' } } } } },
  { type: 'function', function: { name: 'network_status', description: 'Get current Arkiv Tiramisu block and RPC latency.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'navigate_workspace', description: 'Open an available workspace page for the current role.', parameters: { type: 'object', required: ['page'], properties: { page: { type: 'string', enum: ['overview','work','reports','operations','audit','areas','map','activity'] } } } } },
  { type: 'function', function: { name: 'refresh_workspace', description: 'Refresh current public ledger, report and network data.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'prepare_defect_report', description: 'Prepare a pothole or civic defect report draft for the user to review and explicitly confirm. Use only when exact location, BMC ward, description, and severity are available. Do not submit the report.', parameters: { type: 'object', required: ['ward', 'roadName', 'description', 'severity'], properties: { ward: { type: 'string', description: 'BMC ward code, such as K/W. Ask if unknown rather than guessing.' }, roadName: { type: 'string', description: 'Exact road, junction, landmark, and locality.' }, description: { type: 'string', description: 'What the defect is, its size/condition, and any safety impact.' }, severity: { type: 'string', enum: ['minor','moderate','critical','hazardous'] }, latitude: { type: 'number' }, longitude: { type: 'number' }, anonymousDisplay: { type: 'boolean', description: 'Whether to hide reporter identity in public display. Does not hide the signing wallet from public chain metadata.' } } } } },
];
type WorkspacePage = 'overview' | 'work' | 'reports' | 'operations' | 'audit' | 'areas' | 'map' | 'activity';
const CITIZEN_PAGES: WorkspacePage[] = ['overview','work','reports','map','activity'];

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
  const [reportPhoto, setReportPhoto] = useState<File | null>(null);
  const [reportDraft, setReportDraft] = useState<Omit<DefectChallenge, 'timestamp' | 'status' | 'rectificationDeadline'>>();
  const [submittingReport, setSubmittingReport] = useState(false);
  const [submissionStep, setSubmissionStep] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const voiceStopRef = useRef<() => void>(() => {});
  const messagesPaneRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', content: 'Hello! I’m Nagrik Saathi. I can search public records, check network status, refresh your workspace, open citizen pages, and help prepare a civic issue report.' }]);

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
  }, [messages, busy]);

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
      const response = await fetch('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, apiKey: apiKey || undefined, role: 'citizen', tools: SHARED_TOOLS, messages: [{ role: 'system', content: `${SYSTEM}\nYou are operating with citizen-level public access, regardless of the workspace role. Do not claim access to private departmental data or privileged actions. Selected language: ${language}.`, }, ...next] }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`AI request failed (${response.status}): ${explainApiError(data.error || data.message || data)}`);
      const assistant = data.choices?.[0]?.message;
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
            if (!CITIZEN_PAGES.includes(page)) toolAnswers.push('That page is not available to the public assistant.');
            else { onNavigate(page); toolAnswers.push(`Opened the ${page.replaceAll('_', ' ')} page.`); }
          } else if (name === 'refresh_workspace') {
            onRefresh(); toolAnswers.push('Refreshing the workspace from its connected data sources.');
          } else if (name === 'search_tenders') {
            const ward = typeof args.ward === 'string' ? args.ward : undefined;
            const query = typeof args.query === 'string' ? args.query.toLowerCase() : '';
            const result = await fetchTendersFromArkiv(ward);
            const matches = result.tenders.filter(t => (!query || `${t.title} ${t.roadName} ${t.tenderId}`.toLowerCase().includes(query))).slice(0, 8);
            toolAnswers.push(matches.length ? matches.map(t => `${t.tenderId}: ${t.title} — ${t.ward}, ${t.roadName}, ₹${t.budgetInr.toLocaleString('en-IN')}, ${t.status}`).join('\n') : result.source === 'arkiv_chain' ? 'No matching tenders found in the Arkiv ledger.' : 'No matching tenders found in the locally cached on-chain records.');
          } else if (name === 'search_defects') {
            const tenderId = typeof args.tenderId === 'string' ? args.tenderId.toLowerCase() : '';
            const severity = typeof args.severity === 'string' ? args.severity.toLowerCase() : '';
            const defects = await fetchDefectsFromArkiv();
            const matches = defects.filter(d => (!tenderId || d.tenderId.toLowerCase() === tenderId || d.tenderKey.toLowerCase() === tenderId) && (!severity || d.severity.toLowerCase() === severity)).slice(0, 8);
            toolAnswers.push(matches.length ? matches.map(d => `${d.tenderId}: ${d.severity} — ${d.roadName} — ${d.status} — ${d.description}`).join('\n') : 'No matching public defect challenges found in the available Arkiv records.');
          } else if (name === 'network_status') {
            const info = await getTiramisuNetworkInfo();
            toolAnswers.push(info.blockNumber > 0n ? `Arkiv Tiramisu is reachable. Block ${info.blockNumber.toString()}, RPC latency ${info.latencyMs}ms, chain ${info.chainId}.` : `Arkiv Tiramisu did not respond to the RPC check. Chain ${info.chainId}; block and latency are unavailable.`);
          } else if (name === 'prepare_defect_report') {
            const ward = String(args.ward || '').trim().toUpperCase();
            const roadName = String(args.roadName || '').trim();
            const description = String(args.description || '').trim();
            const severityInput = String(args.severity || '').trim().toLowerCase();
            const severityAliases: Record<string, DefectSeverity> = { low: 'minor', medium: 'moderate', high: 'critical', urgent: 'hazardous', minor: 'minor', moderate: 'moderate', critical: 'critical', hazardous: 'hazardous' };
            const severity = severityAliases[severityInput];
            const latitude = args.latitude == null ? undefined : Number(args.latitude);
            const longitude = args.longitude == null ? undefined : Number(args.longitude);
            if (!/^(?:[A-Z]{1,2}\/[A-Z]|[A-Z])$/.test(ward)) toolAnswers.push('I still need a valid BMC ward code (for example K/W). Ask the user which ward applies; do not infer a ward from a broad locality.');
            else if (!roadName || roadName.length < 4) toolAnswers.push('I still need one precise road, junction, or nearby landmark and locality. If the user named multiple areas, ask them to choose the exact spot.');
            else if (!description || description.length < 8) toolAnswers.push('I still need a short description of the defect and any safety impact.');
            else if (!severity) toolAnswers.push('Ask the user to choose a severity: minor, moderate, critical, or hazardous.');
            else if ((latitude == null) !== (longitude == null) || (latitude != null && longitude != null && (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < 18.8 || latitude > 19.5 || longitude < 72.7 || longitude > 73.1))) toolAnswers.push('The coordinates are incomplete or outside Mumbai. Ask for both valid coordinates, or leave both out and use the road/landmark.');
            else {
              setReportDraft({ tenderKey: 'unlinked', tenderId: 'UNLINKED', ward, roadName, description, severity, evidencePhotoCid: '', reportedBy: session.address, reporterRole: 'citizen', latitude, longitude, anonymousDisplay: Boolean(args.anonymousDisplay), department: 'Roads' });
              toolAnswers.push('I prepared a report draft for review. It has NOT been submitted. The user must check the details and press the in-app confirmation button before the wallet is asked to sign.');
            }
          } else toolAnswers.push(`The requested tool “${String(name || 'unknown')}” is not available for this role.`);
        } catch (error) {
          toolAnswers.push(`${String(name || 'Requested action')} failed: ${error instanceof Error ? error.message : 'Unexpected tool error.'}`);
        }
      }
      let answer = [typeof assistant?.content === 'string' ? assistant.content : '', ...toolAnswers].filter(Boolean).join('\n\n');
      if (!answer) answer = 'I could not understand that request.';
      setMessages(current => [...current, { role: 'assistant', content: answer }]);
      speak(answer);
    } catch (error) {
      setMessages(current => [...current, { role: 'assistant', content: `AI connection issue: ${error instanceof Error ? error.message : explainApiError(error)}.` }]);
    } finally { setBusy(false); }
  };

  const confirmDefectReport = async () => {
    if (!reportDraft) return;
    if (!session.isMetaMask || !(window as Window & { ethereum?: unknown }).ethereum) {
      setMessages(current => [...current, { role: 'assistant', content: 'This session is a read-only preview, not a wallet login. Switch to the wallet-connected session to sign this report; nothing has been submitted.' }]);
      return;
    }
    setSubmittingReport(true);
    setSubmissionStep('Checking the wallet used to log in…');
    try {
      const ethereum = (window as unknown as { ethereum: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
      const accounts = await ethereum.request({ method: 'eth_accounts' }) as string[];
      const signerAddress = accounts?.find(address => address.toLowerCase() === session.address.toLowerCase());
      if (!signerAddress) throw new Error('The wallet account used to log in is no longer connected to this site. Reconnect that same account in the app; CivicArk will not switch to another account.');
      const chainId = await ethereum.request({ method: 'eth_chainId' }) as string;
      if (Number.parseInt(chainId, 16) !== TIRAMISU_CHAIN_ID) {
        setSubmissionStep('Switching your logged-in wallet to Arkiv Tiramisu…');
        if (!await switchToTiramisuNetwork()) throw new Error('Could not switch the logged-in wallet to Arkiv Tiramisu. No report transaction was sent.');
      }
      if (reportPhoto) {
        const healthResponse = await fetch('/api/health');
        const health = await healthResponse.json().catch(() => ({}));
        if (!health.photoStorageConfigured) throw new Error('Photo uploads are not configured on this deployment. Remove the photo to submit the report without it, or configure PINATA_JWT in the server environment.');
      }
      let evidencePhotoCid = '';
      if (reportPhoto) {
        if (reportPhoto.size > 3 * 1024 * 1024 || !/^image\/(jpeg|png|webp|heic)$/.test(reportPhoto.type)) throw new Error('Choose a JPEG, PNG, WebP, or HEIC photo under 3 MB.');
        setSubmissionStep('Approve the photo-upload signature in your logged-in wallet…');
        const timestamp = Date.now().toString();
        const digestBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await reportPhoto.arrayBuffer()));
        const digest = Array.from(digestBytes, byte => byte.toString(16).padStart(2, '0')).join('');
        const message = `CivicArk evidence upload\n${session.address}\n${digest}\n${timestamp}`;
        const signature = await (window as unknown as { ethereum: { request: (args: { method: string; params: string[] }) => Promise<string> } }).ethereum.request({ method: 'personal_sign', params: [message, session.address] });
        const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(new Error('Could not read photo.')); reader.readAsDataURL(reportPhoto); });
        const upload = await fetch('/api/evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ base64, name: reportPhoto.name, contentType: reportPhoto.type, address: session.address, timestamp, digest, signature }) });
        const uploadResult = await upload.json();
        if (!upload.ok) throw new Error(uploadResult.error || 'Photo upload failed.');
        evidencePhotoCid = String(uploadResult.cid || '');
      }
      setSubmissionStep('Approve the Arkiv report transaction in your logged-in wallet…');
      const result = await submitDefectChallenge({ ...reportDraft, evidencePhotoCid, reportedBy: reportDraft.anonymousDisplay ? '' : signerAddress, reporterRole: 'citizen' }, { ...session, address: signerAddress });
      setReportDraft(undefined);
      setReportPhoto(null);
      setMessages(current => [...current, { role: 'assistant', content: `Your report was submitted to Arkiv Tiramisu.\n\nTransaction: ${result.txHash}\nEntity: ${result.challenge.key}\n\n${result.challenge.anonymousDisplay ? 'Your identity is hidden in the public report display, but the public chain still shows the signing wallet.' : 'The report is publicly associated with the wallet that signed it.'}` }]);
      onRefresh();
    } catch (error) {
      setMessages(current => [...current, { role: 'assistant', content: `The report was not submitted: ${error instanceof Error ? error.message : 'Unexpected error.'}` }]);
    } finally { setSubmittingReport(false); setSubmissionStep(''); }
  };

  return <>
    <button className="saathi-launcher" onClick={() => setOpen(true)} aria-label="Open Nagrik Saathi"><Bot size={21} /><span>Nagrik Saathi</span></button>
    {open && <aside className="saathi-panel">
      <header><div><Bot size={18} /><strong>Nagrik Saathi</strong><small>Citizen tools · public records</small></div><div className="saathi-actions"><button className={voiceActive ? 'saathi-recording' : ''} onClick={startVoiceAgent} aria-label="Start live voice"><Mic size={16} /></button><button onClick={() => setSettings(!settings)} aria-label="AI settings"><Settings2 size={16} /></button><button onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button></div></header>
      {settings && <section className="saathi-settings"><label>Language<select value={language} onChange={e => { setLanguage(e.target.value); localStorage.setItem('civicark_ai_language', e.target.value); }}><option>Hinglish</option><option>English</option><option>Hindi</option><option>Marathi</option><option>Bengali</option><option>Tamil</option><option>Telugu</option><option>Gujarati</option><option>Kannada</option><option>Malayalam</option><option>Punjabi</option><option>Odia</option><option>Urdu</option></select></label><label>Model<input value={model} onChange={e => { setModel(e.target.value); localStorage.setItem('civicark_ai_model', e.target.value); }} /></label><button type="button" className="btn btn-ghost btn-sm" onClick={() => { localStorage.removeItem('civicark_ai_model'); void fetch('/api/health').then(response => response.json()).then(health => { if (typeof health.model === 'string') setModel(health.model); }).catch(() => setModel('deepseek/deepseek-chat-v3.1:free')); }}>Use gateway default model</button><label>OpenRouter API key <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-or-… · sent for this request" /></label><small>Use an OpenRouter key for the configured gateway. A key is sent only with this request, not stored in the browser. Public chain records are visible to every role.</small></section>}
      <div className="saathi-messages" ref={messagesPaneRef}>
        {messages.map((message, index) => (
          <div className={`saathi-message ${message.role}`} key={`${message.role}-${index}`}>
            <div className="saathi-message-content">{renderMarkdown(message.content)}</div>
            {message.role === 'assistant' && <button onClick={() => speak(message.content)} aria-label="Read aloud"><Volume2 size={13} /></button>}
          </div>
        ))}
        {reportDraft && <section className="saathi-confirm">
          <strong>Review issue report — not submitted</strong>
          <span>{reportDraft.ward} · {reportDraft.roadName} · {reportDraft.severity}</span>
          <span>{reportDraft.description}</span>
          {reportDraft.latitude != null && reportDraft.longitude != null && <span>Coordinates: {reportDraft.latitude}, {reportDraft.longitude}</span>}
          <label><input type="checkbox" checked={Boolean(reportDraft.anonymousDisplay)} onChange={event => setReportDraft(current => current ? { ...current, anonymousDisplay: event.target.checked } : current)} /> Hide my identity in the public report display (the chain still identifies the signing wallet)</label>
          <span>{reportPhoto ? `Photo: ${reportPhoto.name}` : 'Photo optional · attach with the image button below'}</span>
          <small>The wallet you logged in with will sign this report. Wallet login and report submission are separate approvals.</small>
          {submissionStep && <span>{submissionStep}</span>}
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void confirmDefectReport()} disabled={submittingReport}>{submittingReport ? 'Waiting for wallet…' : 'Review & sign with logged-in wallet'}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReportDraft(undefined)} disabled={submittingReport}>Cancel</button>
        </section>}
        {busy && <div className="saathi-message assistant">Thinking…</div>}
      </div>
      <div className="saathi-input"><label className="saathi-attach" aria-label="Attach issue photo" title="Attach issue photo"><ImagePlus size={17} /><input type="file" accept="image/jpeg,image/png,image/webp,image/heic" onChange={event => { const file = event.target.files?.[0]; if (file && (file.size > 3 * 1024 * 1024 || !/^image\/(jpeg|png|webp|heic)$/.test(file.type))) { setMessages(current => [...current, { role: 'assistant', content: 'Choose a JPEG, PNG, WebP, or HEIC photo under 3 MB.' }]); event.target.value = ''; return; } setReportPhoto(file || null); }} /></label><button className={recording ? 'saathi-recording' : ''} onClick={listen} aria-label="Voice input"><Mic size={17} /></button><input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder={recording ? 'Listening…' : 'Ask in Hindi, English or Hinglish…'} /><button onClick={send} aria-label="Send"><Send size={17} /></button></div>
    </aside>}
  </>;
}

type SpeechRecognition = { lang: string; onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; start: () => void };
