export const TIME_LIMIT_MS = 5 * 60 * 1000;
export const TIME_ZONE = 'America/New_York';

export const CATEGORIES = [
  'An action video game', 'Something on a desk', 'A movie', 'A fictional character',
  'A food', 'A place to visit', 'An animal', 'A household item', 'A hobby',
  'A song', 'A book', 'A sport', 'A famous person', 'A TV show', 'A drink',
  'Something in a kitchen', 'A job', 'A board game', 'A plant', 'A clothing item',
  'A brand', 'A city', 'Something at the beach', 'A musical instrument',
  'A type of vehicle', 'Something in a garden', 'A dessert', 'A school subject',
  'A superhero', 'A tool', 'A holiday activity', 'Something in a backpack',
  'A word describing a friend', 'Something in the sky', 'A restaurant dish',
  'A technology product', 'A mythical creature', 'An outdoor activity',
  'A color or shade', 'Something you can collect'
];

const LETTERS = 'ABCDEFGHIKLMNOPRSTW';

export function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

export function challengeFor(day) {
  let seed = 2166136261;
  for (const char of day) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  const next = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pool = [...CATEGORIES];
  const categories = [];
  for (let index = 0; index < 10; index++) {
    categories.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
  }
  return { day, letter: LETTERS[Math.floor(next() * LETTERS.length)], categories };
}

export function newState(now) {
  return {
    pending: Array.from({ length: 10 }, (_, index) => index),
    elapsed: Array(10).fill(0),
    answers: Array(10).fill(null),
    activeSince: now
  };
}

export function isFinished(state, deadline, now) {
  return state.pending.length === 0 || now >= deadline;
}

export function bands(state, deadline, now) {
  return state.answers.map((answer) => {
    if (!answer) return 'missed';
    if (answer.elapsedMs < 10000) return 'fast';
    if (answer.elapsedMs < 30000) return 'good';
    if (answer.elapsedMs < 60000) return 'steady';
    return 'slow';
  });
}

export function shareText(challenge, state) {
  const emoji = { fast: '🟩', good: '🟩', steady: '🟨', slow: '🟧', missed: '⬛' };
  return `Blitzcue ${challenge.day} · ${challenge.letter}\n${bands(state).map((band) => emoji[band]).join('')}`;
}

export function publicGame(row, challenge, now) {
  if (!row) return null;
  const state = JSON.parse(row.state);
  const finished = isFinished(state, row.deadline_at, now);
  return {
    startedAt: row.started_at,
    deadlineAt: row.deadline_at,
    serverNow: now,
    finished,
    completed: state.pending.length === 0,
    currentIndex: finished ? null : state.pending[0],
    answeredCount: 10 - state.pending.length,
    bands: bands(state),
    answers: finished ? state.answers : undefined,
    share: finished ? shareText(challenge, state) : undefined
  };
}
