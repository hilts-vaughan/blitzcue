import { challengeFor, dayKey, isFinished, newState, publicGame, TIME_LIMIT_MS, TIME_ZONE } from './game.js';

const API = 'https://discord.com/api/v10';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

async function discord(path, token, scheme = 'Bearer', options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { authorization: `${scheme} ${token}`, ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(`Discord API returned ${response.status}`);
  return response.json();
}

async function identity(request, env) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /i, '');
  const guildId = request.headers.get('x-guild-id');
  if (!token || !guildId) return null;
  if (env.STANDALONE_ENABLED === 'true' && guildId === 'demo' && /^demo:[a-z0-9_-]{1,24}$/i.test(token)) {
    const id = token.slice(5);
    return { guildId, userId: id, name: id.replace(/[_-]/g, ' ') };
  }
  if (!/^\d{17,22}$/.test(guildId)) return null;
  try {
    const [user, guilds] = await Promise.all([
      discord('/users/@me', token),
      discord('/users/@me/guilds?limit=200', token)
    ]);
    if (!guilds.some((guild) => guild.id === guildId)) return null;
    return { guildId, userId: user.id, name: (user.global_name || user.username || 'Player').slice(0, 80) };
  } catch {
    return null;
  }
}

async function player(env, identity) {
  await env.DB.prepare(`INSERT INTO players (guild_id, user_id, display_name) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET display_name = excluded.display_name`)
    .bind(identity.guildId, identity.userId, identity.name).run();
}

async function gameRow(env, identity, day) {
  return env.DB.prepare('SELECT * FROM games WHERE guild_id = ? AND user_id = ? AND day = ?')
    .bind(identity.guildId, identity.userId, day).first();
}

function resultPayload(challenge, row, now) {
  return { challenge, game: publicGame(row, challenge, now) };
}

async function start(env, identity, challenge, now) {
  const state = newState(now);
  await env.DB.prepare(`INSERT OR IGNORE INTO games
    (guild_id, user_id, day, state, started_at, deadline_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(identity.guildId, identity.userId, challenge.day, JSON.stringify(state), now, now + TIME_LIMIT_MS, now).run();
  return resultPayload(challenge, await gameRow(env, identity, challenge.day), now);
}

function validateAnswer(answer, letter, state) {
  if (typeof answer !== 'string') return 'Type an answer first.';
  const clean = answer.trim().replace(/\s+/g, ' ');
  if (clean.length < 2 || clean.length > 80) return 'Use an answer between 2 and 80 characters.';
  if (!clean.toLocaleUpperCase('en-US').startsWith(letter)) return `Your answer must start with ${letter}.`;
  if (!/^[\p{L}\p{N} .,'’&-]+$/u.test(clean)) return 'Use letters and ordinary punctuation only.';
  if (state.answers.some((item) => item?.text.toLocaleLowerCase('en-US') === clean.toLocaleLowerCase('en-US'))) {
    return 'You already used that answer today.';
  }
  // TODO: Replace this shape check with a category-aware classifier (for example, Jev).
  // Keep the validation server side and only advance after it accepts the answer.
  return null;
}

async function advance(env, identity, challenge, now, action, body) {
  const row = await gameRow(env, identity, challenge.day);
  if (!row) return error('Start the challenge first.', 409);
  const state = JSON.parse(row.state);
  if (isFinished(state, row.deadline_at, now)) return resultPayload(challenge, row, now);
  const currentIndex = state.pending[0];
  if (body.index !== currentIndex) return error('This prompt changed. Refresh the challenge.', 409);
  if (action === 'answer') {
    const reason = validateAnswer(body.answer, challenge.letter, state);
    if (reason) return json({ accepted: false, reason, ...resultPayload(challenge, row, now) });
  }
  state.elapsed[currentIndex] += Math.max(0, now - state.activeSince);
  if (action === 'skip') {
    state.pending.push(state.pending.shift());
  } else {
    state.answers[currentIndex] = { text: body.answer.trim().replace(/\s+/g, ' '), elapsedMs: state.elapsed[currentIndex] };
    state.pending.shift();
  }
  state.activeSince = now;
  const saved = await env.DB.prepare(`UPDATE games SET state = ?, version = version + 1, updated_at = ?
    WHERE guild_id = ? AND user_id = ? AND day = ? AND version = ?`)
    .bind(JSON.stringify(state), now, identity.guildId, identity.userId, challenge.day, row.version).run();
  if (saved.meta.changes !== 1) return error('The challenge changed in another tab. Refresh it.', 409);
  return { accepted: true, ...resultPayload(challenge, await gameRow(env, identity, challenge.day), now) };
}

async function results(env, identity, challenge, now) {
  const rows = await env.DB.prepare(`SELECT games.*, players.display_name FROM games
    JOIN players ON players.guild_id = games.guild_id AND players.user_id = games.user_id
    WHERE games.guild_id = ? AND games.day = ? ORDER BY games.started_at ASC LIMIT 200`)
    .bind(identity.guildId, challenge.day).all();
  return rows.results.map((row) => {
    const game = publicGame(row, challenge, now);
    return {
      userId: row.user_id,
      name: row.display_name,
      finished: game.finished,
      completed: game.completed,
      answeredCount: game.answeredCount,
      bands: game.finished ? game.bands : null
    };
  });
}

async function reminders(env, identity, body) {
  if (identity.guildId === 'demo') return error('Reminders are available inside a Discord server only.');
  if (!env.DISCORD_BOT_TOKEN) return error('The bot token is not configured yet.', 503);
  if (body.enabled === false) {
    await env.DB.prepare('DELETE FROM reminders WHERE guild_id = ?').bind(identity.guildId).run();
    return { enabled: false };
  }
  if (!/^\d{17,22}$/.test(body.channelId || '')) return error('Open the Activity from a server channel to enable reminders.');
  let channel;
  try { channel = await discord(`/channels/${body.channelId}`, env.DISCORD_BOT_TOKEN, 'Bot'); }
  catch { return error('The bot cannot access this channel.'); }
  if (channel.guild_id !== identity.guildId) return error('Choose a channel in this server.');
  await env.DB.prepare(`INSERT INTO reminders (guild_id, channel_id) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id`)
    .bind(identity.guildId, body.channelId).run();
  return { enabled: true };
}

function previousDay(day) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function sendReminders(env, now) {
  if (!env.DISCORD_BOT_TOKEN) return;
  const hour = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(now);
  if (hour !== '09') return;
  const day = dayKey(now);
  const yesterday = previousDay(day);
  const challenge = challengeFor(day);
  let oldest = yesterday;
  for (let index = 0; index < 6; index++) oldest = previousDay(oldest);
  const subscriptions = await env.DB.prepare('SELECT * FROM reminders WHERE last_day IS NULL OR last_day != ?').bind(day).all();
  for (const subscription of subscriptions.results) {
    const rows = await env.DB.prepare(`SELECT games.user_id, games.day, games.state, players.display_name FROM games
      JOIN players ON players.guild_id = games.guild_id AND players.user_id = games.user_id
      WHERE games.guild_id = ? AND games.day < ? AND games.day >= ? ORDER BY games.day DESC`)
      .bind(subscription.guild_id, day, oldest).all();
    const streaks = [];
    for (const row of rows.results.filter((item) => item.day === yesterday && JSON.parse(item.state).pending.length === 0)) {
      let streak = 1;
      let cursor = previousDay(yesterday);
      while (rows.results.some((item) => item.user_id === row.user_id && item.day === cursor && JSON.parse(item.state).pending.length === 0)) {
        streak++;
        cursor = previousDay(cursor);
      }
      if (streak >= 2) streaks.push(`<@${row.user_id}> ${streak} days`);
    }
    const content = `New Daily Scattergories is ready! Today's letter is **${challenge.letter}**. Open the Activity from the App Launcher and take your five minute run.${streaks.length ? `\n🔥 Streaks: ${streaks.slice(0, 5).join(' · ')}` : ''}`;
    try {
      await discord(`/channels/${subscription.channel_id}/messages`, env.DISCORD_BOT_TOKEN, 'Bot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, allowed_mentions: { parse: [], users: streaks.slice(0, 5).map((item) => item.match(/\d+/)[0]) } })
      });
      await env.DB.prepare('UPDATE reminders SET last_day = ? WHERE guild_id = ?').bind(day, subscription.guild_id).run();
    } catch (error) {
      console.error('Reminder failed', subscription.guild_id, error);
    }
  }
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/\.proxy/, '');
  if (path === '/api/config' && request.method === 'GET') {
    return json({ clientId: env.DISCORD_CLIENT_ID || '', standaloneEnabled: env.STANDALONE_ENABLED === 'true' });
  }
  if (path === '/api/auth/exchange' && request.method === 'POST') {
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return error('Discord credentials are not configured.', 503);
    const body = await request.json();
    if (typeof body.code !== 'string' || body.code.length > 300) return error('Invalid authorization code.');
    const response = await fetch(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: body.code })
    });
    if (!response.ok) return error('Discord authorization failed.', 401);
    const token = await response.json();
    return json({ access_token: token.access_token });
  }
  const auth = await identity(request, env);
  if (!auth) return error('Sign in through the Discord Activity first.', 401);
  await player(env, auth);
  const now = Date.now();
  const challenge = challengeFor(dayKey(new Date(now)));
  if (path === '/api/game' && request.method === 'GET') {
    return json(resultPayload(challenge, await gameRow(env, auth, challenge.day), now));
  }
  if (path === '/api/game/start' && request.method === 'POST') return json(await start(env, auth, challenge, now));
  if ((path === '/api/game/answer' || path === '/api/game/skip') && request.method === 'POST') {
    const body = await request.json();
    const data = await advance(env, auth, challenge, now, path.endsWith('skip') ? 'skip' : 'answer', body);
    return data instanceof Response ? data : json(data);
  }
  if (path === '/api/results' && request.method === 'GET') return json({ players: await results(env, auth, challenge, now) });
  if (path === '/api/reminders' && request.method === 'GET') {
    const row = await env.DB.prepare('SELECT channel_id FROM reminders WHERE guild_id = ?').bind(auth.guildId).first();
    return json({ enabled: Boolean(row), channelId: row?.channel_id || null });
  }
  if (path === '/api/reminders' && request.method === 'POST') {
    const data = await reminders(env, auth, await request.json());
    return data instanceof Response ? data : json(data);
  }
  return error('Not found.', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.proxy/api/')) {
      try { return await handleApi(request, env); }
      catch (error) {
        console.error(error);
        return json({ error: 'Something went wrong. Please try again.' }, 500);
      }
    }
    if (url.pathname.startsWith('/.proxy/')) {
      const assetUrl = new URL(url);
      assetUrl.pathname = url.pathname.slice('/.proxy'.length);
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event, env) {
    await sendReminders(env, new Date());
  }
};
