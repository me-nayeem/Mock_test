import dotenv from 'dotenv';

dotenv.config();

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const config = Object.freeze({
  port: num(process.env.PORT, 3000),
  geminiKey: (process.env.GEMINI_API_KEY ?? '').trim(),
  cacheTtlS: num(process.env.CACHE_TTL_S, 600),
  llmMinConfidence: 0.6,
  llmOverrideMin: 0.75,
  cacheMaxEntries: 500,
});

export const llmEnabled = config.geminiKey.length > 0;
