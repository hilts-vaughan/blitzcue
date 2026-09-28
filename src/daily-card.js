import { bands, isFinished } from './game.js';
import { avatarThumbnail, cardDate, playNowRow, safeName } from './card-components.js';

export const DAILY_CARD_VERSION = 2;

const SQUARE = {
  fast: '🟩', quick: '🟩', good: '🟩', steady: '🟨',
  slow: '🟧', overtime: '🟥', missed: '⬛'
};

export function finishedPlayers(rows, now) {
  return rows.flatMap((row) => {
    const state = JSON.parse(row.state);
    if (!isFinished(state, row.deadline_at, now)) return [];
    return [{ ...row, state, squares: bands(state).map((band) => SQUARE[band]) }];
  });
}

export function dailyCard(challenge, players) {
  const date = cardDate(challenge.day);
  const components = [{ type: 10, content: `# Blitzcue · ${date}\n**${challenge.letter}** · ${players.length} ${players.length === 1 ? 'player' : 'players'} finished` }];
  for (const row of players.slice(0, 8)) {
    const squares = `${row.squares.slice(0, 5).join('')}\n${row.squares.slice(5).join('')}`;
    components.push({
      type: 9,
      components: [{ type: 10, content: `**${safeName(row.display_name)}** · ${10 - row.state.pending.length}/10\n${squares}` }],
      accessory: avatarThumbnail(row)
    });
  }
  if (players.length > 8) components.push({ type: 10, content: `+ ${players.length - 8} more players in the Activity` });
  components.push(playNowRow());
  return {
    flags: 32768,
    allowed_mentions: { parse: [] },
    components: [{ type: 17, accent_color: 0x23483b, components }]
  };
}
