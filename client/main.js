import { DiscordSDK } from '@discord/embedded-app-sdk';

const app = document.querySelector('#app');
const standalone = new URLSearchParams(location.search).get('standalone') === '1';
const apiRoot = standalone ? '/api' : '/.proxy/api';
let token = '';
let guildId = '';
let channelId = '';
let userId = '';
let challenge;
let game;
let serverOffset = 0;
let busy = false;
let timerId;

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

async function api(path, options = {}) {
  const response = await fetch(`${apiRoot}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'x-guild-id': guildId,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed.');
  return data;
}

async function connect() {
  const response = await fetch(`${apiRoot}/config`);
  const config = await response.json();
  if (standalone) {
    if (!config.standaloneEnabled) throw new Error('Standalone mode is disabled on this deployment.');
    const params = new URLSearchParams(location.search);
    const demoName = (params.get('player') || 'Player One').replace(/[^a-z0-9_-]/gi, '_').slice(0, 24) || 'Player_One';
    token = `demo:${demoName}`;
    guildId = 'demo';
    userId = demoName;
    return;
  }
  if (!config.clientId) throw new Error('Discord app ID is not configured. Open ?standalone=1 for the local demo.');
  // TODO: In the Discord Developer Portal, enable Activities and map prefix / to the deployed Worker.
  const sdk = new DiscordSDK(config.clientId);
  await sdk.ready();
  if (!sdk.guildId) throw new Error('Open this Activity from a Discord server to see shared results.');
  guildId = sdk.guildId;
  channelId = sdk.channelId || '';
  const { code } = await sdk.commands.authorize({
    client_id: config.clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify', 'guilds']
  });
  const exchange = await fetch(`${apiRoot}/auth/exchange`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code })
  });
  const credentials = await exchange.json();
  if (!exchange.ok) throw new Error(credentials.error || 'Discord sign in failed.');
  token = credentials.access_token;
  const auth = await sdk.commands.authenticate({ access_token: token });
  userId = auth.user.id;
}

function header() {
  const date = new Date(`${challenge.day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return `<header class="topbar"><div class="brand"><span class="logo">✳</span> Daily Scattergories</div><div class="date">${date}</div></header>`;
}

function letterSummary() {
  return `<div class="challenge-summary"><div class="letter">${challenge.letter}</div><div><div class="eyebrow">Today’s letter</div><div class="summary-title">Ten prompts. One letter.</div><div class="muted">The same challenge for everyone today.</div></div></div>`;
}

function renderIntro() {
  app.innerHTML = `${header()}<section class="hero"><div class="eyebrow">The daily word challenge</div><h1>Think fast.<br>Start with ${challenge.letter}.</h1><p>Ten categories, five minutes, and as many clever answers as you can find.</p></section>
    <section class="card intro-card">${letterSummary()}<div class="rules">
      <div class="rule"><span class="rule-num">1</span><span>Answer each category with a word or phrase starting with <strong>${challenge.letter}</strong>.</span></div>
      <div class="rule"><span class="rule-num">2</span><span>Skip a tricky category and it will return after the others.</span></div>
      <div class="rule"><span class="rule-num">3</span><span>Your five minute clock starts when you press Play. Answers are checked before you advance.</span></div>
    </div><button id="start" class="button button-primary button-wide">Play today’s challenge →</button></section>`;
  document.querySelector('#start').addEventListener('click', () => act('/game/start', {}));
}

function clockText() {
  const left = Math.max(0, game.deadlineAt - (Date.now() + serverOffset));
  const seconds = Math.ceil(left / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function renderGame() {
  const index = game.currentIndex;
  app.innerHTML = `${header()}<div class="game-meta"><div><div class="eyebrow">Daily run</div><div class="muted">${game.answeredCount} of 10 answered</div></div><div id="timer" class="timer" role="timer">${clockText()}</div></div>
    <div class="progress-track" aria-label="${game.answeredCount} of 10 answered"><div class="progress-fill" style="width:${game.answeredCount * 10}%"></div></div>
    <section class="card prompt-card"><div class="prompt-count">Category ${index + 1} of 10</div><h2>${escapeHtml(challenge.categories[index])}</h2>
      <p class="lede">What fits this category and begins with ${challenge.letter}?</p>
      <form id="answer-form"><label class="eyebrow" for="answer">Your answer</label><div class="input-wrap"><span class="input-letter">${challenge.letter}</span><input id="answer" class="answer-input" type="text" maxlength="80" autocomplete="off" placeholder="Type your answer" aria-describedby="feedback" autofocus /></div>
      <div id="feedback" class="feedback" role="alert"></div><div class="actions"><button type="button" id="skip" class="button button-secondary">Skip for now</button><button type="submit" class="button button-primary">Confirm answer →</button></div></form></section>
    <p class="side-note">Skipping brings this category back. Your clock keeps running.</p>`;
  document.querySelector('#answer').focus();
  document.querySelector('#answer-form').addEventListener('submit', (event) => {
    event.preventDefault();
    act('/game/answer', { index, answer: document.querySelector('#answer').value });
  });
  document.querySelector('#skip').addEventListener('click', () => act('/game/skip', { index }));
  tick();
  clearInterval(timerId);
  timerId = setInterval(tick, 250);
}

function tick() {
  if (!game || game.finished) return;
  const timer = document.querySelector('#timer');
  if (timer) {
    timer.textContent = clockText();
    timer.classList.toggle('urgent', game.deadlineAt - (Date.now() + serverOffset) <= 30000);
  }
  if (game.deadlineAt <= Date.now() + serverOffset) {
    clearInterval(timerId);
    api('/game').then((data) => { setGame(data); }).catch(showError);
  }
}

function blocks(bands, small = false) {
  return `<div class="${small ? 'mini-blocks' : 'blocks'}" aria-label="${bands.join(', ')}">${bands.map((band) => `<span class="block ${band}" title="${band}"></span>`).join('')}</div>`;
}

async function renderResults() {
  clearInterval(timerId);
  const completed = game.completed;
  app.innerHTML = `${header()}<section class="results-head"><div class="eyebrow">Today’s run</div><h1>${completed ? 'Nicely played.' : 'Time is up.'}</h1><p class="lede">${completed ? 'You found an answer for all ten categories.' : `You answered ${game.answeredCount} of ten categories.`} See how everyone did today.</p></section>
    <section class="card results-card">${letterSummary()}${blocks(game.bands)}
      <div class="legend"><span><i class="block fast"></i>Under 10s</span><span><i class="block good"></i>Under 30s</span><span><i class="block steady"></i>Under 60s</span><span><i class="block slow"></i>60s+</span><span><i class="block missed"></i>Unanswered</span></div>
      <div class="result-actions"><button id="share" class="button button-primary">Share blocks</button><button id="refresh" class="button button-secondary">Refresh server results</button></div></section>
    <h2 class="section-title">Today in your server</h2><div id="players" class="player-list"><div class="empty">Loading results…</div></div>
    ${standalone ? '' : '<div class="reminders"><div><strong>Daily reminders</strong><p>Post the new letter and streaks in this channel at 9 AM Eastern.</p></div><button id="remind" class="button button-quiet">Loading…</button></div>'}`;
  document.querySelector('#share').addEventListener('click', share);
  document.querySelector('#refresh').addEventListener('click', loadResults);
  if (!standalone) loadReminders();
  await loadResults();
}

async function loadResults() {
  try {
    const { players } = await api('/results');
    const sorted = [...players].sort((a, b) => Number(b.completed) - Number(a.completed) || b.answeredCount - a.answeredCount || a.name.localeCompare(b.name));
    document.querySelector('#players').innerHTML = sorted.length ? sorted.map((player) => `<div class="player"><div><div class="player-name">${escapeHtml(player.name)}${player.userId === userId ? ' (you)' : ''}</div><div class="player-detail">${player.finished ? `${player.answeredCount} of 10 answered` : 'Playing now'}</div></div>${player.bands ? blocks(player.bands, true) : '<span class="muted">In progress</span>'}</div>`).join('') : '<div class="empty">Be the first to play today.</div>';
  } catch (error) {
    document.querySelector('#players').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function loadReminders() {
  const button = document.querySelector('#remind');
  try {
    const current = await api('/reminders');
    button.textContent = current.enabled ? 'Turn off' : 'Enable';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const next = await api('/reminders', { method: 'POST', body: JSON.stringify({ enabled: !current.enabled, channelId }) });
        current.enabled = next.enabled;
        button.textContent = current.enabled ? 'Turn off' : 'Enable';
      } catch (error) { alert(error.message); }
      finally { button.disabled = false; }
    });
  } catch (error) { button.textContent = 'Unavailable'; button.disabled = true; }
}

async function share() {
  try {
    if (navigator.share) await navigator.share({ text: game.share });
    else { await navigator.clipboard.writeText(game.share); document.querySelector('#share').textContent = 'Copied!'; }
  } catch (error) {
    if (error.name !== 'AbortError') alert('Could not share the blocks.');
  }
}

function setGame(data) {
  challenge = data.challenge;
  game = data.game;
  if (game) serverOffset = game.serverNow - Date.now();
  if (!game) renderIntro();
  else if (game.finished) renderResults();
  else renderGame();
}

async function act(path, body) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  try {
    const data = await api(path, { method: 'POST', body: JSON.stringify(body) });
    if (data.accepted === false) {
      document.querySelector('#feedback').textContent = data.reason;
      document.querySelectorAll('button').forEach((button) => { button.disabled = false; });
      return;
    }
    setGame(data);
  } catch (error) {
    if (error.message.includes('Refresh')) {
      try { setGame(await api('/game')); } catch { showError(error); }
    } else {
      const feedback = document.querySelector('#feedback');
      if (feedback) feedback.textContent = error.message;
      else showError(error);
      document.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    }
  } finally { busy = false; }
}

function showError(error) {
  clearInterval(timerId);
  app.innerHTML = `<div class="error"><h2>Couldn’t load the challenge</h2><p>${escapeHtml(error.message)}</p><button id="retry" class="button button-primary">Try again</button></div>`;
  document.querySelector('#retry').addEventListener('click', () => location.reload());
}

connect().then(async () => setGame(await api('/game'))).catch(showError);
