export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.ASSEMBLYAI_API_KEY || process.env.ASSEMBLYAI_API_KEY === 'replace-me') return res.status(503).json({ error: 'ASSEMBLYAI_API_KEY is not configured.' });
  const url = new URL('https://streaming.assemblyai.com/v3/token');
  url.searchParams.set('expires_in_seconds', process.env.ASSEMBLYAI_VOICE_TOKEN_TTL_SECONDS || '60');
  url.searchParams.set('max_session_duration_seconds', process.env.ASSEMBLYAI_MAX_SESSION_SECONDS || '600');
  const upstream = await fetch(url, { headers: { authorization: process.env.ASSEMBLYAI_API_KEY } });
  res.status(upstream.status).json(await upstream.json());
}
