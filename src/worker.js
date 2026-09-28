import { advanceClock, challengeFor, dayKey, isFinished, newState, publicGame, TIME_LIMIT_MS, TIME_ZONE } from './game.js';
import { categoryFits } from './classifier.js';
import { DAILY_CARD_VERSION, dailyCard, finishedPlayers } from './daily-card.js';
import { PLAY_CUSTOM_ID } from './card-components.js';
import { reminderCard } from './reminder-card.js';

const API = 'https://discord.com/api/v10';
const AVATAR_HASH = /^(?:a_)?[a-f0-9]{32}$/;
const SESSION_LIFETIME_MS = 2 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
}

async function sessionKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signSession(env, identity) {
  const payload = base64Url(encoder.encode(JSON.stringify({
    guildId: identity.guildId,
    userId: identity.userId,
    name: identity.name,
    avatarHash: identity.avatarHash,
    expiresAt: Date.now() + SESSION_LIFETIME_MS
  })));
  const signature = await crypto.subtle.sign('HMAC', await sessionKey(env.DISCORD_CLIENT_SECRET), encoder.encode(payload));
  return `session.${payload}.${base64Url(new Uint8Array(signature))}`;
}

async function verifySession(env, token, guildId) {
  if (!env.DISCORD_CLIENT_SECRET || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'session') return null;
  try {
    const valid = await crypto.subtle.verify('HMAC', await sessionKey(env.DISCORD_CLIENT_SECRET), fromBase64Url(parts[2]), encoder.encode(parts[1]));
    if (!valid) return null;
    const payload = JSON.parse(decoder.decode(fromBase64Url(parts[1])));
    if (payload.guildId !== guildId || !/^\d{17,22}$/.test(payload.userId) ||
        typeof payload.name !== 'string' || payload.name.length > 80 ||
        (payload.avatarHash != null && !AVATAR_HASH.test(payload.avatarHash)) ||
        typeof payload.expiresAt !== 'number' || payload.expiresAt <= Date.now()) return null;
    return { guildId, userId: payload.userId, name: payload.name, avatarHash: payload.avatarHash };
  } catch {
    return null;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

function hexBytes(value) {
  if (!/^(?:[a-f0-9]{2})+$/i.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g), (byte) => parseInt(byte, 16));
}

async function handleInteraction(request, env) {
  const signature = request.headers.get('x-signature-ed25519') || '';
  const timestamp = request.headers.get('x-signature-timestamp') || '';
  const publicKey = hexBytes(env.DISCORD_PUBLIC_KEY || '');
  const signatureBytes = hexBytes(signature);
  if (request.method !== 'POST' || publicKey?.length !== 32 || signatureBytes?.length !== 64 ||
      !/^\d{10,}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    return error('Invalid interaction signature.', 401);
  }
  const body = await request.text();
  if (body.length > 65536) return error('Interaction too large.', 413);
  const key = await crypto.subtle.importKey('raw', publicKey, 'Ed25519', false, ['verify']);
  const valid = await crypto.subtle.verify('Ed25519', key, signatureBytes, encoder.encode(timestamp + body));
  if (!valid) return error('Invalid interaction signature.', 401);
  let interaction;
  try { interaction = JSON.parse(body); }
  catch { return error('Invalid interaction body.'); }
  if (interaction.type === 1) return json({ type: 1 });
  if (interaction.type === 2 && interaction.data?.type === 1 &&
      interaction.data.name === 'blitzcue' && interaction.guild_id) return json({ type: 12 });
  if (interaction.type === 3 && interaction.data?.component_type === 2 && interaction.data.custom_id === PLAY_CUSTOM_ID) {
    return interaction.guild_id
      ? json({ type: 12 })
      : json({ type: 4, data: { content: 'Open Blitzcue in a server channel to play.', flags: 64 } });
  }
  return error('Unsupported interaction.');
}

async function discord(path, token, scheme = 'Bearer', options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { authorization: `${scheme} ${token}`, ...(options.headers || {}) }
  });
  if (!response.ok) {
    const failure = new Error(`Discord API returned ${response.status}`);
    failure.status = response.status;
    failure.retryAfter = Number(response.headers.get('retry-after')) || 0;
    throw failure;
  }
  return response.json();
}

async function discordIdentityRequest(path, token) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await discord(path, token, 'Bearer', { signal: AbortSignal.timeout(8000) });
    } catch (failure) {
      if (attempt || (failure.status && failure.status !== 429 && failure.status < 500)) throw failure;
      await new Promise((resolve) => setTimeout(resolve, Math.min(2000, Math.max(400, failure.retryAfter * 1000))));
    }
  }
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
  if (token.startsWith('session.')) return verifySession(env, token, guildId);
  return discordIdentity(token, guildId);
}

async function discordIdentity(token, guildId) {
  try {
    const [user, guilds] = await Promise.all([
      discordIdentityRequest('/users/@me', token),
      discordIdentityRequest('/users/@me/guilds?limit=200', token)
    ]);
    if (!guilds.some((guild) => guild.id === guildId)) return null;
    return {
      guildId,
      userId: user.id,
      name: (user.global_name || user.username || 'Player').slice(0, 80),
      avatarHash: typeof user.avatar === 'string' && AVATAR_HASH.test(user.avatar) ? user.avatar : null
    };
  } catch (failure) {
    if (!failure.status || failure.status === 429 || failure.status >= 500) throw failure;
    return null;
  }
}

async function player(env, identity) {
  const avatarKnown = identity.avatarHash !== undefined;
  const avatarHash = identity.avatarHash === null ? '-' : identity.avatarHash || null;
  await env.DB.prepare(`INSERT INTO players (guild_id, user_id, display_name, avatar_hash) VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET display_name = excluded.display_name,
      avatar_hash = CASE WHEN ? = 1 THEN excluded.avatar_hash ELSE players.avatar_hash END`)
    .bind(identity.guildId, identity.userId, identity.name, avatarHash, avatarKnown ? 1 : 0).run();
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

async function clockUpdate(env, identity, challenge, now, mode) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await gameRow(env, identity, challenge.day);
    if (!row) return resultPayload(challenge, null, now);
    const state = JSON.parse(row.state);
    if (!isFinished(state, row.deadline_at, now)) {
      advanceClock(state, row.deadline_at, row.started_at, now);
      if (mode === 'pause') state.running = false;
      if (mode === 'resume') {
        state.running = true;
        state.activeSince = now;
      }
      const saved = await env.DB.prepare(`UPDATE games SET state = ?, version = version + 1, updated_at = ?
        WHERE guild_id = ? AND user_id = ? AND day = ? AND version = ?`)
        .bind(JSON.stringify(state), now, identity.guildId, identity.userId, challenge.day, row.version).run();
      if (saved.meta.changes !== 1) continue;
      row.state = JSON.stringify(state);
    }
    return resultPayload(challenge, row, now);
  }
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
  return null;
}

async function advance(env, identity, challenge, now, action, body) {
  await clockUpdate(env, identity, challenge, now, 'resume');
  const row = await gameRow(env, identity, challenge.day);
  if (!row) return error('Start the challenge first.', 409);
  const state = JSON.parse(row.state);
  if (isFinished(state, row.deadline_at, now)) return resultPayload(challenge, row, now);
  const currentIndex = state.pending[0];
  if (body.index !== currentIndex) return error('This prompt changed. Refresh the challenge.', 409);
  if (action === 'answer') {
    const reason = validateAnswer(body.answer, challenge.letter, state);
    if (reason) return json({ accepted: false, reason, ...resultPayload(challenge, row, now) });
    try {
      const fits = await categoryFits(env, challenge.categories[currentIndex], body.answer.trim().replace(/\s+/g, ' '));
      if (!fits) return json({ accepted: false, reason: 'That answer does not fit this category. Try another.', ...resultPayload(challenge, row, Date.now()) });
    } catch (error) {
      console.error('Answer validation unavailable:', error);
      return json({ accepted: false, reason: 'Answer checking is temporarily unavailable. Please try again.', ...resultPayload(challenge, row, Date.now()) });
    }
  }
  if (action === 'skip') {
    state.pending.push(state.pending.shift());
  } else {
    state.answers[currentIndex] = { text: body.answer.trim().replace(/\s+/g, ' '), elapsedMs: state.elapsed[currentIndex] };
    state.pending.shift();
  }
  state.activeSince = action === 'answer' ? Date.now() : now;
  const saved = await env.DB.prepare(`UPDATE games SET state = ?, version = version + 1, updated_at = ?
    WHERE guild_id = ? AND user_id = ? AND day = ? AND version = ?`)
    .bind(JSON.stringify(state), now, identity.guildId, identity.userId, challenge.day, row.version).run();
  if (saved.meta.changes !== 1) return error('The challenge changed in another tab. Refresh it.', 409);
  return { accepted: true, ...resultPayload(challenge, await gameRow(env, identity, challenge.day), Date.now()) };
}

async function results(env, identity, challenge, now) {
  const rows = await env.DB.prepare(`SELECT games.*, players.display_name, players.avatar_hash FROM games
    JOIN players ON players.guild_id = games.guild_id AND players.user_id = games.user_id
    WHERE games.guild_id = ? AND games.day = ? ORDER BY games.started_at ASC LIMIT 200`)
    .bind(identity.guildId, challenge.day).all();
  return rows.results.map((row) => {
    const game = publicGame(row, challenge, now);
    return {
      userId: row.user_id,
      name: row.display_name,
      avatarUrl: row.avatar_hash === '-'
        ? `./avatar/default/${Number((BigInt(row.user_id) >> 22n) % 6n)}.png`
        : AVATAR_HASH.test(row.avatar_hash || '')
          ? `./avatar/users/${row.user_id}/${row.avatar_hash}.webp`
          : null,
      finished: game.finished,
      paused: game.paused,
      completed: game.completed,
      answeredCount: game.answeredCount,
      bands: game.finished ? game.bands : null
    };
  });
}

async function registerReminder(env, guildId, channelId) {
  if (!env.DISCORD_BOT_TOKEN || !/^\d{17,22}$/.test(channelId || '')) return;
  const existing = await env.DB.prepare('SELECT channel_id FROM reminders WHERE guild_id = ?').bind(guildId).first();
  if (existing?.channel_id === channelId) return;
  let channel;
  try { channel = await discord(`/channels/${channelId}`, env.DISCORD_BOT_TOKEN, 'Bot'); }
  catch (error) {
    console.error('Could not register reminder channel:', guildId, error);
    return;
  }
  if (channel.guild_id !== guildId) return;
  await env.DB.prepare(`INSERT INTO reminders (guild_id, channel_id) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id`)
    .bind(guildId, channelId).run();
}

async function scheduleReminderRegistration(request, env, ctx, guildId) {
  if (guildId === 'demo') return;
  const registration = registerReminder(env, guildId, request.headers.get('x-channel-id'))
    .catch((error) => console.error('Reminder registration failed:', guildId, error));
  if (ctx?.waitUntil) ctx.waitUntil(registration);
  else await registration;
}

async function updateDailyCard(env, guildId, challenge, channelId) {
  if (!env.DISCORD_BOT_TOKEN || guildId === 'demo') return;
  let card = await env.DB.prepare('SELECT channel_id FROM daily_cards WHERE guild_id = ? AND day = ?')
    .bind(guildId, challenge.day).first();
  if (!card) {
    if (!/^\d{17,22}$/.test(channelId || '')) return;
    const channel = await discord(`/channels/${channelId}`, env.DISCORD_BOT_TOKEN, 'Bot', { signal: AbortSignal.timeout(8000) });
    if (channel.guild_id !== guildId) return;
    await env.DB.prepare('INSERT OR IGNORE INTO daily_cards (guild_id, day, channel_id) VALUES (?, ?, ?)')
      .bind(guildId, challenge.day, channelId).run();
  }
  await env.DB.prepare('UPDATE daily_cards SET desired_version = desired_version + 1 WHERE guild_id = ? AND day = ?')
    .bind(guildId, challenge.day).run();
  const lease = Date.now() + 60000;
  const acquired = await env.DB.prepare(`UPDATE daily_cards SET lock_until = ?
    WHERE guild_id = ? AND day = ? AND lock_until < ?`)
    .bind(lease, guildId, challenge.day, Date.now()).run();
  if (acquired.meta.changes !== 1) return;
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      card = await env.DB.prepare('SELECT * FROM daily_cards WHERE guild_id = ? AND day = ?')
        .bind(guildId, challenge.day).first();
      const rows = await env.DB.prepare(`SELECT games.*, players.display_name, players.avatar_hash FROM games
        JOIN players ON players.guild_id = games.guild_id AND players.user_id = games.user_id
        WHERE games.guild_id = ? AND games.day = ? ORDER BY games.updated_at ASC, games.user_id ASC LIMIT 200`)
        .bind(guildId, challenge.day).all();
      const players = finishedPlayers(rows.results, Date.now());
      if (!players.length) return;
      const signature = JSON.stringify([DAILY_CARD_VERSION, players.map((row) => [row.user_id, row.version, row.display_name, row.avatar_hash])]);
      let messageId = card.message_id;
      if (!messageId || signature !== card.signature) {
        const payload = dailyCard(challenge, players);
        const path = `/channels/${card.channel_id}/messages${messageId ? `/${messageId}` : ''}`;
        const method = messageId ? 'PATCH' : 'POST';
        if (!messageId) {
          payload.nonce = `${challenge.day.replaceAll('-', '')}${guildId.slice(-15)}`;
          payload.enforce_nonce = true;
        }
        let message;
        try {
          message = await discord(path, env.DISCORD_BOT_TOKEN, 'Bot', {
            method,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(8000)
          });
        } catch (error) {
          if (messageId && error.status === 404) {
            await env.DB.prepare('UPDATE daily_cards SET message_id = NULL, signature = NULL WHERE guild_id = ? AND day = ?')
              .bind(guildId, challenge.day).run();
            continue;
          }
          throw error;
        }
        messageId = message.id;
        await env.DB.prepare('UPDATE daily_cards SET message_id = ?, signature = ? WHERE guild_id = ? AND day = ?')
          .bind(messageId, signature, guildId, challenge.day).run();
      }
      const applied = await env.DB.prepare(`UPDATE daily_cards SET applied_version = ?, lock_until = 0
        WHERE guild_id = ? AND day = ? AND desired_version = ? AND lock_until = ?`)
        .bind(card.desired_version, guildId, challenge.day, card.desired_version, lease).run();
      if (applied.meta.changes === 1) return;
    }
  } finally {
    await env.DB.prepare('UPDATE daily_cards SET lock_until = 0 WHERE guild_id = ? AND day = ? AND lock_until = ?')
      .bind(guildId, challenge.day, lease).run();
  }
}

function scheduleDailyCard(request, env, ctx, auth, challenge, data) {
  if (!data?.game?.finished || auth.guildId === 'demo') return;
  const update = updateDailyCard(env, auth.guildId, challenge, request.headers.get('x-channel-id'))
    .catch((error) => console.error('Daily card update failed:', auth.guildId, challenge.day, error));
  if (ctx?.waitUntil) ctx.waitUntil(update);
  else return update;
}

async function avatarImage(path) {
  const custom = path.match(/^\/avatar\/users\/(\d{17,22})\/((?:a_)?[a-f0-9]{32})\.webp$/);
  const fallback = path.match(/^\/avatar\/default\/([0-5])\.png$/);
  if (!custom && !fallback) return new Response('Not found', { status: 404 });
  const cdnPath = custom
    ? `/avatars/${custom[1]}/${custom[2]}.webp?size=128`
    : `/embed/avatars/${fallback[1]}.png`;
  const image = await fetch(`https://cdn.discordapp.com${cdnPath}`);
  if (!image.ok) return new Response('Not found', { status: 404 });
  return new Response(image.body, {
    headers: {
      'content-type': image.headers.get('content-type') || 'image/webp',
      'cache-control': 'public, max-age=604800, immutable'
    }
  });
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
    const rows = await env.DB.prepare(`SELECT games.user_id, games.day, games.state, players.display_name, players.avatar_hash FROM games
      JOIN players ON players.guild_id = games.guild_id AND players.user_id = games.user_id
      WHERE games.guild_id = ? AND games.day < ? AND games.day >= ? ORDER BY games.day DESC`)
      .bind(subscription.guild_id, day, oldest).all();
    const payload = reminderCard(challenge, yesterday, rows.results);
    payload.nonce = `r${day.replaceAll('-', '')}${subscription.guild_id.slice(-15)}`;
    payload.enforce_nonce = true;
    try {
      await discord(`/channels/${subscription.channel_id}/messages`, env.DISCORD_BOT_TOKEN, 'Bot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000)
      });
      await env.DB.prepare('UPDATE reminders SET last_day = ? WHERE guild_id = ?').bind(day, subscription.guild_id).run();
    } catch (error) {
      console.error('Reminder failed', subscription.guild_id, error);
    }
  }
}

async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/\.proxy/, '');
  if (path === '/api/config' && request.method === 'GET') {
    return json({ clientId: env.DISCORD_CLIENT_ID || '', standaloneEnabled: env.STANDALONE_ENABLED === 'true' });
  }
  if (path === '/api/auth/exchange' && request.method === 'POST') {
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return error('Discord credentials are not configured.', 503);
    const body = await request.json();
    if (typeof body.code !== 'string' || body.code.length > 300) return error('Invalid authorization code.');
    if (body.guildId !== undefined && !/^\d{17,22}$/.test(body.guildId)) return error('Invalid Discord server.');
    let response;
    try {
      response = await fetch(`${API}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: body.code }),
        signal: AbortSignal.timeout(8000)
      });
    } catch (failure) {
      console.error('Discord token exchange failed', failure);
      return error('Could not reach Discord. Please try again.', 503);
    }
    if (!response.ok) return response.status === 429 || response.status >= 500
      ? error('Discord is temporarily unavailable. Please try again.', 503)
      : error('Discord authorization failed. Please try again.', 401);
    const token = await response.json();
    if (!body.guildId) return json({ access_token: token.access_token });
    let auth;
    try {
      auth = await discordIdentity(token.access_token, body.guildId);
    } catch (failure) {
      console.error('Discord identity lookup failed', failure);
      return error('Discord is temporarily unavailable. Please try again.', 503);
    }
    if (!auth) return error('Could not verify your Discord server. Please reopen the Activity.', 401);
    return json({ access_token: token.access_token, session_token: await signSession(env, auth) });
  }
  const auth = await identity(request, env);
  if (!auth) return error('Sign in through the Discord Activity first.', 401);
  await player(env, auth);
  const now = Date.now();
  const challenge = challengeFor(dayKey(new Date(now)));
  if (path === '/api/game' && request.method === 'GET') {
    const data = await clockUpdate(env, auth, challenge, now, 'resume');
    await scheduleDailyCard(request, env, ctx, auth, challenge, data);
    return json(data);
  }
  if (path === '/api/game/start' && request.method === 'POST') {
    const data = await start(env, auth, challenge, now);
    await scheduleReminderRegistration(request, env, ctx, auth.guildId);
    return json(data);
  }
  if ((path === '/api/game/ping' || path === '/api/game/pause') && request.method === 'POST') {
    const data = await clockUpdate(env, auth, challenge, now, path.endsWith('pause') ? 'pause' : 'ping');
    await scheduleDailyCard(request, env, ctx, auth, challenge, data);
    return json(data);
  }
  if ((path === '/api/game/answer' || path === '/api/game/skip') && request.method === 'POST') {
    const body = await request.json();
    const data = await advance(env, auth, challenge, now, path.endsWith('skip') ? 'skip' : 'answer', body);
    await scheduleReminderRegistration(request, env, ctx, auth.guildId);
    if (!(data instanceof Response)) await scheduleDailyCard(request, env, ctx, auth, challenge, data);
    return data instanceof Response ? data : json(data);
  }
  if (path === '/api/results' && request.method === 'GET') return json({ players: await results(env, auth, challenge, now) });
  return error('Not found.', 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/\.proxy/, '');
    if (path === '/interactions') return handleInteraction(request, env);
    if (path.startsWith('/avatar/')) return avatarImage(path);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.proxy/api/')) {
      try { return await handleApi(request, env, ctx); }
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
