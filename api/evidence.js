import { createHash } from 'node:crypto';
import { verifyMessage } from 'viem';

export const config = { api: { bodyParser: { sizeLimit: '4.3mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const token = process.env.PINATA_JWT;
  if (!token || token === 'replace-me') return res.status(503).json({ error: 'Photo storage is not configured. Add PINATA_JWT to the server environment, or paste an existing IPFS CID.' });

  try {
    const { base64, name, contentType, address, timestamp, digest, signature } = req.body || {};
    if (typeof base64 !== 'string' || !/^image\/(jpeg|png|webp|heic)$/.test(contentType || '')) return res.status(400).json({ error: 'Choose a JPEG, PNG, WebP or HEIC photo.' });
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.length > 3 * 1024 * 1024) return res.status(413).json({ error: 'Photo must be smaller than 3 MB.' });
    const actualDigest = createHash('sha256').update(bytes).digest('hex');
    const sentAt = Number(timestamp);
    if (!/^0x[a-fA-F0-9]{40}$/.test(address || '') || !/^0x[a-fA-F0-9]{130}$/.test(signature || '') || digest !== actualDigest || !Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > 5 * 60_000) return res.status(401).json({ error: 'Photo upload needs a fresh wallet signature.' });
    const message = `CivicArk evidence upload\n${address}\n${actualDigest}\n${timestamp}`;
    if (!await verifyMessage({ address, message, signature })) return res.status(401).json({ error: 'Photo upload wallet signature could not be verified.' });
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: contentType }), String(name || 'civic-evidence').slice(0, 120));
    form.append('pinataMetadata', JSON.stringify({ name: 'Civic report evidence' }));
    const upstream = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    const result = await upstream.json();
    if (!upstream.ok || !result.IpfsHash) return res.status(502).json({ error: result.error || result.message || 'IPFS provider rejected the photo.' });
    return res.status(201).json({ cid: result.IpfsHash, uri: `ipfs://${result.IpfsHash}` });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : 'Photo upload failed.' });
  }
}
