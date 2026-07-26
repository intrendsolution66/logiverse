// backend/src/utils/systemSettings.ts
//
// Small key-value settings lookup backed by edu.system_settings, with the
// corresponding env var as a fallback default. Falls back to env var (or a
// hardcoded default) rather than throwing if nothing's been set in the DB
// yet — an empty settings table shouldn't break asset uploads on a fresh
// install, it should just mean "use the same default behavior as before
// this table existed."
//
// Cached in memory for a short window rather than querying on every single
// asset upload — this value changes rarely (an operator editing it in
// Settings), so a few seconds of staleness after an edit is an acceptable
// tradeoff against hitting the DB on every file save.

import { query } from "../config/db.js";

const cache = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL_MS = 10_000;

export async function getSetting(key: string, envFallback: string): Promise<string> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const { rows } = await query(`SELECT value FROM edu.system_settings WHERE key = $1`, [key]);
  const value = rows[0]?.value ?? envFallback;
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function setSetting(key: string, value: string, updatedBy: string): Promise<void> {
  await query(
    `INSERT INTO edu.system_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [key, value, updatedBy]
  );
  cache.delete(key); // next read picks up the new value immediately instead of waiting out the TTL
}

export async function getAssetBaseUrl(): Promise<string> {
  return getSetting("asset_base_url", process.env.ASSET_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`);
}
