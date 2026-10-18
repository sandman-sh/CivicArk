import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyMessage } from 'viem';

const root = path.dirname(fileURLToPath(import.meta.url));

// Load local .env
const loadEnv = () => {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match) {
      const val = match[2].trim().replace(/^['"]|['"]$/g, '');
      if (val) process.env[match[1]] = val;
    }
  }
};
loadEnv();

const port = Number(process.env.PORT || 8787);
const AI_CITIZEN_PAGES = ['overview','work','reports','map','activity'];

const json = (res, status, value) => {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
};

const readBody = (req, limit = 1_000_000) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > limit) reject(new Error('Request payload too large'));
  });
  req.on('end', () => {
    try {
      resolve(raw ? JSON.parse(raw) : {});
    } catch {
      reject(new Error('Invalid JSON'));
    }
  });
  req.on('error', reject);
});

const handleApi = async (req, res, pathname) => {
  if (pathname === '/api/health' && req.method === 'GET') {
    json(res, 200, {
      ok: true,
      model: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat',
      assemblyConfigured: Boolean(process.env.ASSEMBLYAI_API_KEY && process.env.ASSEMBLYAI_API_KEY !== 'replace-me'),
    });
    return true;
  }

  if (pathname === '/api/ai/chat' && req.method === 'POST') {
    try {
      const input = await readBody(req);
      const key = input.apiKey || process.env.OPENROUTER_API_KEY;
      if (!key || key === 'replace-me') {
        json(res, 503, { error: 'No AI provider key is configured. Add one in settings or configure OPENROUTER_API_KEY in .env' });
        return true;
      }
      const providerUrl = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
      const provider = new URL(providerUrl);
      if (provider.protocol !== 'https:' || provider.hostname !== 'openrouter.ai' || provider.pathname !== '/api/v1/chat/completions') {
        json(res, 500, { error: 'AI requests are restricted to the configured OpenRouter HTTPS endpoint.' });
        return true;
      }
      const model = input.model || process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat';
      const allowedTools = new Set(['search_tenders','search_defects','network_status','navigate_workspace','refresh_workspace','prepare_defect_report']);
      const tools = (Array.isArray(input.tools) ? input.tools : []).filter(tool => allowedTools.has(tool?.function?.name)).map(tool => tool.function.name !== 'navigate_workspace' ? tool : { ...tool, function: { ...tool.function, parameters: { ...tool.function.parameters, properties: { ...tool.function.parameters?.properties, page: { ...tool.function.parameters?.properties?.page, enum: AI_CITIZEN_PAGES } } } } });
      const upstream = await fetch(providerUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
          'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173',
          'X-Title': 'CivicArk',
        },
        body: JSON.stringify({
          model,
          messages: input.messages || [],
          temperature: 0.2,
          max_tokens: input.max_tokens || 1024,
          tools: tools.length ? tools : undefined,
          tool_choice: tools.length ? 'auto' : undefined,
        }),
      });
      const text = await upstream.text();
      const response = JSON.parse(text);
      response.authorizedRole = 'citizen';
      res.writeHead(upstream.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(response));
      return true;
    } catch (error) {
      json(res, 502, { error: error instanceof Error ? error.message : 'AI provider request failed.' });
      return true;
    }
  }

  if (pathname === '/api/evidence' && req.method === 'POST') {
    try {
      const input = await readBody(req, 4_400_000);
      if (!process.env.PINATA_JWT || process.env.PINATA_JWT === 'replace-me') { json(res, 503, { error: 'Photo storage is not configured. Add PINATA_JWT to the server environment, or paste an existing IPFS CID.' }); return true; }
      if (typeof input.base64 !== 'string' || !/^image\/(jpeg|png|webp|heic)$/.test(input.contentType || '')) { json(res, 400, { error: 'Choose a JPEG, PNG, WebP or HEIC photo.' }); return true; }
      const bytes = Buffer.from(input.base64, 'base64');
      if (!bytes.length || bytes.length > 3 * 1024 * 1024) { json(res, 413, { error: 'Photo must be smaller than 3 MB.' }); return true; }
      const digest = createHash('sha256').update(bytes).digest('hex');
      const sentAt = Number(input.timestamp);
      if (!/^0x[a-fA-F0-9]{40}$/.test(input.address || '') || !/^0x[a-fA-F0-9]{130}$/.test(input.signature || '') || input.digest !== digest || !Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > 5 * 60_000) { json(res, 401, { error: 'Photo upload needs a fresh wallet signature.' }); return true; }
      const message = `CivicArk evidence upload\n${input.address}\n${digest}\n${input.timestamp}`;
      if (!await verifyMessage({ address: input.address, message, signature: input.signature })) { json(res, 401, { error: 'Photo upload wallet signature could not be verified.' }); return true; }
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: input.contentType }), String(input.name || 'civic-evidence').slice(0, 120));
      form.append('pinataMetadata', JSON.stringify({ name: 'Civic report evidence' }));
      const upstream = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', { method: 'POST', headers: { authorization: `Bearer ${process.env.PINATA_JWT}` }, body: form });
      const result = await upstream.json();
      if (!upstream.ok || !result.IpfsHash) { json(res, 502, { error: result.error || result.message || 'IPFS provider rejected the photo.' }); return true; }
      json(res, 201, { cid: result.IpfsHash, uri: `ipfs://${result.IpfsHash}` });
    } catch (error) { json(res, 400, { error: error instanceof Error ? error.message : 'Photo upload failed.' }); }
    return true;
  }

  if (pathname === '/api/voice-token') {
    if (req.method !== 'GET') { json(res, 405, { error: 'Method not allowed' }); return true; }
    if (!process.env.ASSEMBLYAI_API_KEY || process.env.ASSEMBLYAI_API_KEY === 'replace-me') {
      json(res, 503, { error: 'ASSEMBLYAI_API_KEY is not configured on the server.' });
      return true;
    }
    const tokenUrl = new URL('https://agents.assemblyai.com/v1/token');
    tokenUrl.searchParams.set('expires_in_seconds', process.env.ASSEMBLYAI_VOICE_TOKEN_TTL_SECONDS || '60');
    tokenUrl.searchParams.set('max_session_duration_seconds', process.env.ASSEMBLYAI_MAX_SESSION_SECONDS || '900');
    const upstream = await fetch(tokenUrl, { headers: { authorization: `Bearer ${process.env.ASSEMBLYAI_API_KEY}` } });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(text);
    return true;
  }

  if (pathname === '/api/stt-token') {
    if (req.method !== 'GET') { json(res, 405, { error: 'Method not allowed' }); return true; }
    if (!process.env.ASSEMBLYAI_API_KEY || process.env.ASSEMBLYAI_API_KEY === 'replace-me') {
      json(res, 503, { error: 'ASSEMBLYAI_API_KEY is not configured on the server.' });
      return true;
    }
    const tokenUrl = new URL('https://streaming.assemblyai.com/v3/token');
    tokenUrl.searchParams.set('expires_in_seconds', process.env.ASSEMBLYAI_VOICE_TOKEN_TTL_SECONDS || '60');
    tokenUrl.searchParams.set('max_session_duration_seconds', process.env.ASSEMBLYAI_MAX_SESSION_SECONDS || '600');
    const upstream = await fetch(tokenUrl, { headers: { authorization: process.env.ASSEMBLYAI_API_KEY } });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(text);
    return true;
  }

  return false;
};

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, pathname);
      if (handled) return;
      return json(res, 404, { error: 'API endpoint not found' });
    }

    // Static file serving fallback for production builds
    const file = pathname === '/' ? '/dist/index.html' : `/dist${pathname}`;
    const distRoot = path.resolve(root, 'dist');
    const target = path.resolve(root, `.${file}`);

    if (!target.startsWith(distRoot)) return json(res, 400, { error: 'Invalid path' });
    const finalFile = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(distRoot, 'index.html');

    if (!fs.existsSync(finalFile)) return json(res, 404, { error: 'Build not found. Run npm run build first.' });

    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
      '.json': 'application/json',
    }[path.extname(finalFile)] || 'application/octet-stream';

    res.writeHead(200, { 'content-type': mime });
    fs.createReadStream(finalFile).pipe(res);
  } catch (err) {
    console.error('Request error:', err);
    if (!res.headersSent) {
      json(res, 500, { error: 'Internal server error' });
    }
  }
});

process.on('uncaughtException', err => {
  console.error('Server process uncaughtException caught:', err);
});

server.listen(port, () => console.log(`CivicArk secure AI gateway listening on http://localhost:${port}`));
