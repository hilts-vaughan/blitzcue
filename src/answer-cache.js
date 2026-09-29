// Bump this integer when changing the judging policy to invalidate previous entries.
export const ANSWER_CACHE_VERSION = 2;

function cacheKey(value) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export async function cachedAcceptance(env, category, answer) {
  try {
    const row = await env.DB.prepare(`SELECT accepted FROM answer_cache
      WHERE version = ? AND category_key = ? AND answer_key = ?`)
      .bind(ANSWER_CACHE_VERSION, cacheKey(category), cacheKey(answer)).first();
    return row?.accepted === 1;
  } catch (error) {
    console.warn('Answer cache lookup failed; using live classification:', error);
    return false;
  }
}

export async function cacheAcceptance(env, category, answer, decision) {
  if (!decision.accepted) return;
  try {
    await env.DB.prepare(`INSERT INTO answer_cache
      (version, category_key, answer_key, accepted, provider, jev_probability, created_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(version, category_key, answer_key) DO NOTHING`)
      .bind(ANSWER_CACHE_VERSION, cacheKey(category), cacheKey(answer), decision.provider, decision.jevProbability, Date.now()).run();
  } catch (error) {
    console.warn('Could not cache accepted answer:', error);
  }
}
