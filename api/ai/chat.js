const allowedMethods = new Set(['POST']);
const citizenPages = ['overview','work','reports','map','activity'];

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
  const allowedNames = new Set(['search_tenders', 'search_defects', 'network_status', 'navigate_workspace', 'refresh_workspace']);
  const tools = (Array.isArray(body.tools) ? body.tools : []).filter(tool => allowedNames.has(tool?.function?.name)).map(tool => {
    if (tool.function.name !== 'navigate_workspace') return tool;
    return { ...tool, function: { ...tool.function, parameters: { ...tool.function.parameters, properties: { ...tool.function.parameters?.properties, page: { ...tool.function.parameters?.properties?.page, enum: citizenPages } } } } };
  });
  try {
    const upstream = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, 'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173', 'X-Title': 'CivicArk' }, body: JSON.stringify({ model, messages: body.messages || [], tools, tool_choice: tools.length ? 'auto' : 'none' }) });
    const text = await upstream.text();
    let providerBody;
    try {
      providerBody = JSON.parse(text);
    } catch {
      // Providers and proxies can return plain-text/HTML errors. Keep the
      // function response JSON so the chat UI can display a useful message.
      return res.status(502).json({
        error: `AI provider returned a non-JSON response (HTTP ${upstream.status}).`,
        details: text.slice(0, 500),
      });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(upstream.status).json({ ...providerBody, authorizedRole: 'citizen' });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : 'AI provider request failed.' });
  }
}
