import { dayKey } from './game.js';

export const JEV_DAILY_CALL_LIMIT = 1500;

export async function reserveJevCall(env) {
  try {
    // Reserve before sending the request. This single conditional write also
    // enforces the limit when several Worker instances submit concurrently.
    const result = await env.DB.prepare(`INSERT INTO jev_daily_usage (day, calls) VALUES (?, 1)
      ON CONFLICT(day) DO UPDATE SET calls = jev_daily_usage.calls + 1
      WHERE jev_daily_usage.calls < ?`)
      .bind(dayKey(), JEV_DAILY_CALL_LIMIT).run();
    return result.meta.changes === 1;
  } catch (error) {
    // Without a recorded reservation, use Workers AI to preserve the paid cap.
    console.warn('Could not reserve Jev quota; using Workers AI:', error);
    return false;
  }
}
