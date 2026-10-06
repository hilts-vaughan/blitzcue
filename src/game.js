export const TIME_LIMIT_MS = 3 * 60 * 1000;
export const HEARTBEAT_GRACE_MS = 7 * 1000;
export const TIME_ZONE = "America/New_York";

export const CATEGORIES = [
  "An action video game",
  "Something on a desk",
  "A movie",
  "A fictional character",
  "A food",
  "A place to visit",
  "An animal",
  "A household item",
  "A hobby",
  "A song",
  "A book",
  "A sport",
  "A famous person",
  "A TV show",
  "A drink",
  "Something in a kitchen",
  "A job",
  "A board game",
  "A plant",
  "A clothing item",
  "A brand",
  "A city",
  "Something at the beach",
  "A musical instrument",
  "A type of vehicle",
  "Something in a garden",
  "A dessert",
  "A school subject",
  "A tool",
  "A holiday activity",
  "Something in a backpack",
  "A word describing a friend",
  "Something in the sky",
  "A restaurant dish",
  "A technology product",
  "A mythical creature",
  "An outdoor activity",
  "A color or shade",
  "Something you can collect",
];

const LETTERS = "ABCDEFGHIKLMNOPRSTW";

export function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function challengeFor(day) {
  let seed = 2166136261;
  for (const char of day)
    seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  const next = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const pool = [...new Set(CATEGORIES)];
  const categories = [];
  for (let index = 0; index < 10; index++) {
    categories.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
  }
  return {
    day,
    letter: LETTERS[Math.floor(next() * LETTERS.length)],
    categories,
  };
}

export function newState(now) {
  return {
    pending: Array.from({ length: 10 }, (_, index) => index),
    elapsed: Array(10).fill(0),
    answers: Array(10).fill(null),
    activeSince: now,
    remainingMs: TIME_LIMIT_MS,
    timeLimitMs: TIME_LIMIT_MS,
    running: true,
  };
}

export function isFinished(state, deadline, now) {
  return (
    state.pending.length === 0 ||
    (state.remainingMs === undefined ? now >= deadline : state.remainingMs <= 0)
  );
}

export function advanceClock(state, deadline, startedAt, now) {
  if (state.remainingMs === undefined) {
    state.remainingMs = Math.max(0, deadline - now);
    state.activeSince = now;
    state.running = true;
  }
  if (state.timeLimitMs === undefined) {
    const oldLimit = Math.max(0, deadline - startedAt);
    state.remainingMs = Math.max(
      0,
      state.remainingMs - Math.max(0, oldLimit - TIME_LIMIT_MS),
    );
    state.timeLimitMs = TIME_LIMIT_MS;
  }
  if (!state.running || isFinished(state, deadline, now)) return;
  const elapsed = Math.min(
    Math.max(0, now - state.activeSince),
    HEARTBEAT_GRACE_MS,
    state.remainingMs,
  );
  state.remainingMs -= elapsed;
  if (state.pending.length) state.elapsed[state.pending[0]] += elapsed;
  state.activeSince = now;
}

export function bands(state, deadline, now) {
  return state.answers.map((answer) => {
    if (!answer) return "missed";
    if (answer.elapsedMs < 10000) return "fast";
    if (answer.elapsedMs < 20000) return "steady";
    return "slow";
  });
}

export const BAND_EMOJI = { fast: "🟩", steady: "🟨", slow: "🟧", missed: "⬛" };
export const MAX_SCORE = 30;

export function score(state) {
  const points = { fast: 3, steady: 2, slow: 1, missed: 0 };
  return bands(state).reduce((total, band) => total + points[band], 0);
}

export function shareText(challenge, state) {
  return `Blitzcue ${challenge.day} · ${challenge.letter}\n${bands(state)
    .map((band) => BAND_EMOJI[band])
    .join("")}`;
}

export function publicGame(row, challenge, now) {
  if (!row) return null;
  const state = JSON.parse(row.state);
  const finished = isFinished(state, row.deadline_at, now);
  return {
    startedAt: row.started_at,
    deadlineAt:
      state.remainingMs === undefined
        ? row.deadline_at
        : now + state.remainingMs,
    serverNow: now,
    finished,
    paused: !finished && state.running === false,
    completed: state.pending.length === 0,
    currentIndex: finished ? null : state.pending[0],
    answeredCount: 10 - state.pending.length,
    bands: bands(state),
    answers: finished ? state.answers : undefined,
    share: finished ? shareText(challenge, state) : undefined,
  };
}
