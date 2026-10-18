import { verifyMessage } from 'viem';

const allowedMethods = new Set(['POST']);
const roleWalletEnv = { engineer: 'CIVICARK_ENGINEER_WALLETS', contractor: 'CIVICARK_CONTRACTOR_WALLETS', auditor: 'CIVICARK_AUDITOR_WALLETS' };
const rolePages = { citizen: ['overview','work','reports','map','activity'], engineer: ['overview','work','reports','operations','audit','areas','map','activity'], contractor: ['overview','work','reports','operations','map','activity'], auditor: ['overview','work','reports','audit','areas','map','activity'] };

async function resolveAuthorizedRole(input) {
  if (input.role === 'citizen') return 'citizen';
  const envName = roleWalletEnv[input.role];
  const proof = input.roleProof;
  if (!envName || !proof || String(proof.address).toLowerCase() !== String(input.address).toLowerCase() || !/^0x[a-fA-F0-9]{40}$/.test(proof.address || '') || !/^0x[a-fA-F0-9]{130}$/.test(proof.signature || '')) return 'citizen';
  const expires = Number(proof.expires);
  if (!Number.isFinite(expires) || expires < Date.now() || expires > Date.now() + 120_000) return 'citizen';
  const allowlist = (process.env[envName] || '').split(',').map(address => address.trim().toLowerCase()).filter(Boolean);
  if (!allowlist.includes(proof.address.toLowerCase())) return 'citizen';
  const message = `CivicArk AI role proof\n${input.role}\n${proof.address.toLowerCase()}\n${expires}`;
  try { return await verifyMessage({ address: proof.address, message, signature: proof.signature }) ? input.role : 'citizen'; }
  catch { return 'citizen'; }
}

export default async function handler(req, res) {
  if (!allowedMethods.has(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body || {};
  const endpoint = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
  const model = body.model || process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat-v3.1:free';
  const apiKey = body.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === 'replace-me') return res.status(503).json({ error: 'No AI provider key is configured.' });
  let target;
  try { target = new URL(endpoint); } catch { return res.status(500).json({ error: 'AI provider endpoint is invalid.' }); }
  if (target.protocol !== 'https:' || target.hostname !== 'openrouter.ai' || target.pathname !== '/api/v1/chat/completions') return res.status(500).json({ error: 'AI requests are restricted to the configured OpenRouter HTTPS endpoint.' });
  const authorizedRole = await resolveAuthorizedRole(body);
  const allowedNames = new Set(['search_tenders', 'search_defects', 'network_status', 'navigate_workspace', 'refresh_workspace']);
  if (authorizedRole === 'engineer') allowedNames.add('create_tender');
  const tools = (Array.isArray(body.tools) ? body.tools : []).filter(tool => allowedNames.has(tool?.function?.name)).map(tool => {
    if (tool.function.name !== 'navigate_workspace') return tool;
    return { ...tool, function: { ...tool.function, parameters: { ...tool.function.parameters, properties: { ...tool.function.parameters?.properties, page: { ...tool.function.parameters?.properties?.page, enum: rolePages[authorizedRole] } } } } };
  });
  try {
    const upstream = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, 'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173', 'X-Title': 'CivicArk' }, body: JSON.stringify({ model, messages: body.messages || [], tools, tool_choice: tools.length ? 'auto' : 'none' }) });
    const text = await upstream.text();
    res.status(upstream.status).type('application/json').send(JSON.stringify({ ...JSON.parse(text), authorizedRole }));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'AI provider request failed.' });
  }
}
