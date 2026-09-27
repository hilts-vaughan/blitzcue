# Blitzcue

A five minute daily letter and category game for Discord. Everyone gets the same letter and ten categories for the date in `America/New_York`. A run is saved on the server, so refreshing does not reset the deadline. Skipped categories return after the others. The results page shows ten colored blocks and other players in the same server.

## Local demo

```sh
npm install
npm run db:local
npm run dev
```

Open `http://127.0.0.1:8787/?standalone=1`. Add `&player=Friend` in another browser window to simulate a second player. Demo identities and their results are isolated in the `demo` guild. The page uses the same Worker API and D1 database as the Discord Activity.

Run the browser test while the local Worker is running:

```sh
npm run test:e2e
```

The test covers refresh, rejection, skipping, completion, and results from two players.

## Discord setup

1. Create an app named **Blitzcue** in the [Discord Developer Portal](https://discord.com/developers/applications). Enable **Activities** and set an Activity URL mapping with prefix `/` and target your deployed Worker hostname. Discord creates the default **Launch** entry point when Activities are enabled.
2. In OAuth2, add the placeholder redirect `https://127.0.0.1`. The Embedded App SDK handles the Activity authorization callback. Give the app the `identify` and `guilds` scopes when asked.
3. Put the app's client ID in `DISCORD_CLIENT_ID` in `wrangler.jsonc`. For local Discord testing, copy `.dev.vars.example` to `.dev.vars` and fill in the client secret and bot token.
4. Install the app in a server. The Activity uses the current guild and player identity to keep server results separate. It needs a server launch; DM launches are not part of this version.
5. To post reminders, invite the bot with permission to view and send messages in the chosen channel. A player can enable reminders in that channel from the results screen. At 9 AM Eastern, the Worker posts the new letter and streaks from completed prior runs.

Discord's [Activity tutorial](https://discord.com/developers/docs/activities/building-an-activity) covers the portal settings and URL mapping.

## Cloudflare deployment

Create a D1 database and replace the placeholder `database_id` in `wrangler.jsonc` with the ID returned by Wrangler:

```sh
npx wrangler d1 create blitzcue
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put DISCORD_BOT_TOKEN
npm run db:remote
npm run deploy
```

`DISCORD_BOT_TOKEN` is needed for reminders; game play works without it. To close public demo access after testing, set `STANDALONE_ENABLED` to `false` in `wrangler.jsonc` and deploy again. Never commit `.dev.vars` or Discord secrets.

The Worker serves the static app and API from one deployment. D1 stores runs, names, and reminder channels. Cron runs at 13:00 and 14:00 UTC and sends only when local Eastern time is 09:00, accounting for daylight saving time.

## Answer checking

The server currently checks length, first letter, characters, and repeated answers. `src/worker.js` has a TODO where a category aware classifier such as Jev should decide whether an answer genuinely fits. This placeholder is intentionally permissive; it allows the whole flow to work while the model integration is pending.

Block colors are bright green for under 10 seconds, green for under 30, yellow for under 60, orange for accepted answers taking longer, and gray for unanswered categories. Time on a skipped prompt is added when that prompt returns.
