import { bands, isFinished } from './game.js';

const SQUARE = {
  fast: '🟩', quick: '🟩', good: '🟩', steady: '🟨',
  slow: '🟧', overtime: '🟥', missed: '⬛'
};

function safeName(name) {
  return String(name || 'Player').slice(0, 80).replace(/([\\`*_{}\[\]()~>|])/g, '\\$1').replace(/@/g, '@\u200b');
}

function avatarUrl(row) {
  if (/^(?:a_)?[a-f0-9]{32}$/.test(row.avatar_hash || '')) {
    return `https://cdn.discordapp.com/avatars/${row.user_id}/${row.avatar_hash}.webp?size=128`;
  }
  const index = Number((BigInt(row.user_id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

export function finishedPlayers(rows, now) {
  return rows.flatMap((row) => {
    const state = JSON.parse(row.state);
    if (!isFinished(state, row.deadline_at, now)) return [];
    return [{ ...row, state, squares: bands(state).map((band) => SQUARE[band]) }];
  });
}

export function dailyCard(challenge, players) {
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric'
  }).format(new Date(`${challenge.day}T12:00:00Z`));
  const components = [{ type: 10, content: `# Blitzcue · ${date}\n**${challenge.letter}** · ${players.length} ${players.length === 1 ? 'player' : 'players'} finished` }];
  for (const row of players.slice(0, 8)) {
    const squares = `${row.squares.slice(0, 5).join('')}\n${row.squares.slice(5).join('')}`;
    components.push({
      type: 9,
      components: [{ type: 10, content: `**${safeName(row.display_name)}** · ${10 - row.state.pending.length}/10\n${squares}` }],
      accessory: { type: 11, media: { url: avatarUrl(row) }, description: `${String(row.display_name || 'Player').slice(0, 80)}'s avatar` }
    });
  }
  if (players.length > 8) components.push({ type: 10, content: `+ ${players.length - 8} more players in the Activity` });
  return {
    flags: 32768,
    allowed_mentions: { parse: [] },
    components: [{ type: 17, accent_color: 0x23483b, components }]
  };
}
