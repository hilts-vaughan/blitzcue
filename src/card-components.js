export const PLAY_CUSTOM_ID = 'blitzcue:play';

export function playNowRow() {
  return {
    type: 1,
    components: [{ type: 2, style: 3, label: 'Play now', custom_id: PLAY_CUSTOM_ID }]
  };
}

export function safeName(name) {
  return String(name || 'Player').slice(0, 80).replace(/([\\`*_{}\[\]()~>|])/g, '\\$1').replace(/@/g, '@\u200b');
}

export function avatarThumbnail(row) {
  const url = /^(?:a_)?[a-f0-9]{32}$/.test(row.avatar_hash || '')
    ? `https://cdn.discordapp.com/avatars/${row.user_id}/${row.avatar_hash}.webp?size=128`
    : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(row.user_id) >> 22n) % 6n)}.png`;
  return { type: 11, media: { url }, description: `${String(row.display_name || 'Player').slice(0, 80)}'s avatar` };
}

export function cardDate(day) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric'
  }).format(new Date(`${day}T12:00:00Z`));
}
