import { DiscordSDK } from "@discord/embedded-app-sdk";
import "@picocss/pico/css/pico.min.css";

const app = document.querySelector("#app");
const standalone =
  new URLSearchParams(location.search).get("standalone") === "1";
const apiRoot = standalone ? "/api" : "/.proxy/api";
let token = "";
let guildId = "";
let channelId = "";
let userId = "";
let challenge;
let game;
let serverOffset = 0;
let busy = false;
let timerId;

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );

async function api(path, options = {}) {
  const response = await fetch(`${apiRoot}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      "x-guild-id": guildId,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The request failed.");
  return data;
}

async function connect() {
  const response = await fetch(`${apiRoot}/config`);
  const config = await response.json();
  if (standalone) {
    if (!config.standaloneEnabled)
      throw new Error("Standalone mode is disabled on this deployment.");
    const params = new URLSearchParams(location.search);
    const demoName =
      (params.get("player") || "Player One")
        .replace(/[^a-z0-9_-]/gi, "_")
        .slice(0, 24) || "Player_One";
    token = `demo:${demoName}`;
    guildId = "demo";
    userId = demoName;
    return;
  }
  if (!config.clientId)
    throw new Error(
      "Discord app ID is not configured. Open ?standalone=1 for the local demo.",
    );
  // TODO: In the Discord Developer Portal, enable Activities and map prefix / to the deployed Worker.
  const sdk = new DiscordSDK(config.clientId);
  await sdk.ready();
  if (!sdk.guildId)
    throw new Error(
      "Open this Activity from a Discord server to see shared results.",
    );
  guildId = sdk.guildId;
  channelId = sdk.channelId || "";
  const { code } = await sdk.commands.authorize({
    client_id: config.clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify", "guilds"],
  });
  const exchange = await fetch(`${apiRoot}/auth/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const credentials = await exchange.json();
  if (!exchange.ok)
    throw new Error(credentials.error || "Discord sign in failed.");
  token = credentials.access_token;
  const auth = await sdk.commands.authenticate({ access_token: token });
  userId = auth.user.id;
}

function header() {
  const date = new Date(`${challenge.day}T12:00:00Z`).toLocaleDateString(
    "en-US",
    { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" },
  );
  return `<header class="topbar"><strong class="brand">Blitzcue</strong><div class="header-actions"><span class="date">${date}</span><button type="button" id="help" class="help-button" aria-label="How to play" aria-haspopup="dialog" aria-controls="help-dialog">?</button></div></header>
    <dialog id="help-dialog" aria-labelledby="help-title"><article><header><button type="button" id="help-close" aria-label="Close" rel="prev"></button><h2 id="help-title">How to play</h2></header>
      <p>Answer ten category prompts as fast as you can; every answer must begin with today’s letter: <strong>${challenge.letter}.</strong> The quicker you answer, the better the score. Just make sure not to duplicate any answers.</p>
      <p>If you are stuck, you can skip a prompt to revisit it later.</p>
    </article></dialog>`;
}

function renderIntro() {
  app.innerHTML = `${header()}<section class="intro"><p class="kicker">TODAY’S LETTER</p><div id="intro-letter" class="letter" role="img" aria-label="Today's letter: ${challenge.letter}">?</div>
    <p class="intro-copy">A new letter and ten categories every day.</p>
    <button id="start" class="button button-primary">Play today</button></section>`;
  revealIntroLetter();
  document
    .querySelector("#start")
    .addEventListener("click", () => act("/game/start", {}));
}

async function revealIntroLetter() {
  const tile = document.querySelector("#intro-letter");
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    tile.textContent = challenge.letter;
    return;
  }

  const letters = [..."ABCDEFGHIKLMNOPRSTW".replace(challenge.letter, "")];
  const sequence = Array.from({ length: 7 }, () =>
    letters.splice(Math.floor(Math.random() * letters.length), 1)[0],
  );
  sequence.push(challenge.letter);
  tile.textContent = sequence[0];

  for (let index = 1; index < sequence.length; index++) {
    if (!tile.isConnected) return;
    const halfDuration = index === sequence.length - 1 ? 95 : 65;
    const flipOut = tile.animate(
      [{ transform: "rotateX(0deg)" }, { transform: "rotateX(90deg)" }],
      { duration: halfDuration, easing: "ease-in", fill: "forwards" },
    );
    try {
      await flipOut.finished;
    } catch {
      return;
    }
    if (!tile.isConnected) return;
    tile.textContent = sequence[index];
    const flipIn = tile.animate(
      [{ transform: "rotateX(-90deg)" }, { transform: "rotateX(0deg)" }],
      { duration: halfDuration, easing: "ease-out" },
    );
    flipOut.cancel();
    try {
      await flipIn.finished;
    } catch {
      return;
    }
  }
}

function clockText() {
  const left = Math.max(0, game.deadlineAt - (Date.now() + serverOffset));
  const seconds = Math.ceil(left / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function renderGame() {
  const index = game.currentIndex;
  const progress = game.bands.map((band) =>
    band === "missed" ? "pending" : band,
  );
  app.innerHTML = `${header()}<section class="game"><div class="game-meta"><span class="muted">${game.answeredCount} of 10 answered</span><strong id="timer" class="timer" role="timer">${clockText()}</strong></div>
    ${blocks(progress, false, true)}
    <section class="prompt-card"><p class="prompt-count">Category ${index + 1} of 10</p><div class="prompt-heading"><div class="letter" aria-label="Starting letter ${challenge.letter}">${challenge.letter}</div><h2>${escapeHtml(challenge.categories[index])}</h2></div>
      <form id="answer-form"><input id="answer" class="answer-input" type="text" maxlength="80" autocomplete="off" placeholder="Type an answer" aria-label="Answer for ${escapeHtml(challenge.categories[index])}, starting with ${challenge.letter}" aria-describedby="feedback" autofocus />
      <div id="feedback" class="feedback" role="alert"></div><div class="actions"><button type="button" id="skip" class="button button-secondary">Skip for now</button><button type="submit" class="button button-primary">Confirm answer</button></div></form></section>
    </section>`;
  document.querySelector("#answer").focus();
  document.querySelector("#answer-form").addEventListener("submit", (event) => {
    event.preventDefault();
    act("/game/answer", {
      index,
      answer: document.querySelector("#answer").value,
    });
  });
  document
    .querySelector("#skip")
    .addEventListener("click", () => act("/game/skip", { index }));
  tick();
  clearInterval(timerId);
  timerId = setInterval(tick, 250);
}

function tick() {
  if (!game || game.finished) return;
  const timer = document.querySelector("#timer");
  if (timer) {
    timer.textContent = clockText();
    timer.classList.toggle(
      "urgent",
      game.deadlineAt - (Date.now() + serverOffset) <= 30000,
    );
  }
  if (game.deadlineAt <= Date.now() + serverOffset) {
    clearInterval(timerId);
    api("/game")
      .then((data) => {
        setGame(data);
      })
      .catch(showError);
  }
}

function blocks(bands, small = false, progress = false) {
  return `<div class="${small ? "mini-blocks" : "blocks"}${progress ? " progress-grid" : ""}" aria-label="${bands.join(", ")}">${bands.map((band, index) => `<span class="block ${band}" title="${band}">${progress ? index + 1 : ""}</span>`).join("")}</div>`;
}

async function renderResults() {
  clearInterval(timerId);
  const completed = game.completed;
  app.innerHTML = `${header()}<section class="results"><div class="results-head"><p class="kicker">TODAY’S RUN · ${challenge.letter}</p><h1>${completed ? "Nicely played." : "Time is up."}</h1><p>${game.answeredCount} of 10 answered</p></div>
    <section class="results-card">${blocks(game.bands)}
      <div class="legend"><span><i class="block fast"></i>&lt;10s</span><span><i class="block good"></i>&lt;30s</span><span><i class="block steady"></i>&lt;60s</span><span><i class="block slow"></i>60s+</span><span><i class="block missed"></i>Missed</span></div>
      <button id="share" class="button button-primary">Share results</button></section>
    <div class="section-heading"><h2 class="section-title">Your server</h2><button id="refresh" class="text-button" aria-label="Refresh server results">Refresh</button></div><div id="players" class="player-list"><div class="empty">Loading results…</div></div>
    ${standalone ? "" : '<div class="reminders"><div><strong>Daily reminders</strong><p>New letter and streaks at 9 AM Eastern.</p></div><button id="remind" class="button button-secondary">Loading…</button></div>'}</section>`;
  document.querySelector("#share").addEventListener("click", share);
  document.querySelector("#refresh").addEventListener("click", loadResults);
  if (!standalone) loadReminders();
  await loadResults();
}

async function loadResults() {
  try {
    const { players } = await api("/results");
    const sorted = [...players].sort(
      (a, b) =>
        Number(b.completed) - Number(a.completed) ||
        b.answeredCount - a.answeredCount ||
        a.name.localeCompare(b.name),
    );
    document.querySelector("#players").innerHTML = sorted.length
      ? sorted
          .map(
            (player) =>
              `<div class="player"><div class="avatar" aria-hidden="true">${escapeHtml(player.name.charAt(0).toUpperCase())}</div><div class="player-name">${escapeHtml(player.name)}${player.userId === userId ? " (you)" : ""}</div>${player.bands ? blocks(player.bands, true) : '<span class="player-detail">Playing now</span>'}<div class="player-detail">${player.finished ? `${player.answeredCount} of 10 answered` : "In progress"}</div></div>`,
          )
          .join("")
      : '<div class="empty">Be the first to play today.</div>';
  } catch (error) {
    document.querySelector("#players").innerHTML =
      `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function loadReminders() {
  const button = document.querySelector("#remind");
  try {
    const current = await api("/reminders");
    button.textContent = current.enabled ? "Turn off" : "Enable";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const next = await api("/reminders", {
          method: "POST",
          body: JSON.stringify({ enabled: !current.enabled, channelId }),
        });
        current.enabled = next.enabled;
        button.textContent = current.enabled ? "Turn off" : "Enable";
      } catch (error) {
        alert(error.message);
      } finally {
        button.disabled = false;
      }
    });
  } catch (error) {
    button.textContent = "Unavailable";
    button.disabled = true;
  }
}

async function share() {
  const answers = challenge.categories.map((category, index) => {
    const answer = game.answers[index]?.text;
    return `${index + 1}. ||${category}||: ${answer ? `||${answer}||` : "No answer"}`;
  });
  const text = `${game.share}\n\nAnswers\n${answers.join("\n")}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else {
      await navigator.clipboard.writeText(text);
      document.querySelector("#share").textContent = "Copied!";
    }
  } catch (error) {
    if (error.name !== "AbortError") alert("Could not share your results.");
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
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
  try {
    const data = await api(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (data.accepted === false) {
      document.querySelector("#feedback").textContent = data.reason;
      document.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
      return;
    }
    setGame(data);
  } catch (error) {
    if (error.message.includes("Refresh")) {
      try {
        setGame(await api("/game"));
      } catch {
        showError(error);
      }
    } else {
      const feedback = document.querySelector("#feedback");
      if (feedback) feedback.textContent = error.message;
      else showError(error);
      document.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
    }
  } finally {
    busy = false;
  }
}

function showError(error) {
  clearInterval(timerId);
  app.innerHTML = `<div class="error"><h2>Couldn’t load the challenge</h2><p>${escapeHtml(error.message)}</p><button id="retry" class="button button-primary">Try again</button></div>`;
  document
    .querySelector("#retry")
    .addEventListener("click", () => location.reload());
}

app.addEventListener("click", (event) => {
  if (event.target.closest("#help")) app.querySelector("#help-dialog").showModal();
  if (event.target.closest("#help-close")) app.querySelector("#help-dialog").close();
});

connect()
  .then(async () => setGame(await api("/game")))
  .catch(showError);
