export default function handler(_req, res) {
  res.status(200).json({
    ok: true,
    model: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat-v3.1:free',
    assemblyConfigured: Boolean(process.env.ASSEMBLYAI_API_KEY && process.env.ASSEMBLYAI_API_KEY !== 'replace-me'),
    photoStorageConfigured: Boolean(process.env.PINATA_JWT && process.env.PINATA_JWT !== 'replace-me'),
  });
}
