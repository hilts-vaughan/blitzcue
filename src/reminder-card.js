import { MAX_SCORE, score } from './game.js';
import { avatarThumbnail, cardDate, playNowRow, safeName } from './card-components.js';

export function reminderCard(challenge, yesterday, rows) {
  const games = rows.map((row) => ({ ...row, state: JSON.parse(row.state) }));
  const previous = games.filter((row) => row.day === yesterday);
  const highest = previous.reduce((best, row) => Math.max(best, score(row.state)), 0);
  const winners = previous.filter((row) => score(row.state) === highest);
  const components = [
    { type: 10, content: `# Blitzcue · ${cardDate(challenge.day)}\nToday's letter is **${challenge.letter}**. Ten prompts. Three minutes.` }
  ];
  if (winners.length) {
    const names = winners.slice(0, 5).map((row) => `**${safeName(row.display_name)}**`).join(', ');
    const more = winners.length > 5 ? ` and ${winners.length - 5} more` : '';
    const content = `🏆 Yesterday's ${winners.length === 1 ? 'winner' : 'joint winners'}\n${names}${more} · **${highest}/${MAX_SCORE}**`;
    components.push(winners.length === 1
      ? { type: 9, components: [{ type: 10, content }], accessory: avatarThumbnail(winners[0]) }
      : { type: 10, content });
  }
  const streaks = [];
  for (const row of previous.filter((game) => game.state.pending.length === 0)) {
    let streak = 1;
    const cursor = new Date(`${yesterday}T12:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    while (games.some((game) => game.user_id === row.user_id && game.day === cursor.toISOString().slice(0, 10) && game.state.pending.length === 0)) {
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    if (streak >= 2) streaks.push({ userId: row.user_id, days: streak });
  }
  streaks.sort((a, b) => b.days - a.days || a.userId.localeCompare(b.userId));
  if (streaks.length) {
    components.push({ type: 10, content: `🔥 Streaks: ${streaks.slice(0, 5).map((item) => `<@${item.userId}> ${item.days} days`).join(' · ')}` });
  }
  components.push(playNowRow());
  return {
    flags: 32768,
    allowed_mentions: { parse: [], users: streaks.slice(0, 5).map((item) => item.userId) },
    components: [{ type: 17, accent_color: 0x23483b, components }]
  };
}
