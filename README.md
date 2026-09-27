# Blitzcue

A three minute daily letter and category game for Discord. Everyone gets the same letter and ten categories for the date in `America/New_York`. A run is saved on the server; its clock pauses when the Activity closes and resumes with the remaining time when the player returns. Skipped categories return after the others. The results page shows ten colored blocks and other players in the same server.

## Local demo

```sh
npm install
npm run db:local
npm run dev
```

Open `http://127.0.0.1:8787/?standalone=1`. Add `&player=Friend` in another browser window to simulate a second player. Demo identities and their results are isolated in the `demo` guild. The page uses the same Worker API, D1 database, and answer classifier as the Discord Activity. Wrangler will prompt you to sign in to Cloudflare for Workers AI inference, including during local development.

Run the browser test while the local Worker is running:

```sh
npm run test:e2e
```

The test covers refresh, rejection, skipping, completion, and results from two players.

## Discord setup

1. Create an app named **Blitzcue** in the [Discord Developer Portal](https://discord.com/developers/applications). Enable **Activities** and set an Activity URL mapping with prefix `/` and target your deployed Worker hostname. Discord creates the default **Launch** entry point when Activities are enabled.
2. In **OAuth2 → Redirects**, add the deployed Worker's HTTPS URL (for example, `https://blitzcue.<your-subdomain>.workers.dev/`) and save it. Use the same hostname configured as the Activity URL mapping target, with `https://` and a trailing `/`. Discord requires a registered redirect, but the Embedded App SDK handles returning users to the Activity; no callback route is needed in the Worker. Give the app the `identify` and `guilds` scopes when asked.
3. The application ID `1553854788569927832` is set as `DISCORD_CLIENT_ID` in `wrangler.jsonc`. For local Discord testing, copy `.dev.vars.example` to `.dev.vars` and fill in the client secret. For the deployed Activity, copy `.prod.vars.example` to `.prod.vars` and fill in the current client secret; `npm run deploy` uploads it with the Worker. Add the bot token for daily reminder messages or to register `/blitzcue`. Both secret files are ignored by Git.
4. Install the app in a server. The Activity uses the current guild and player identity to keep server results separate. It needs a server launch; DM launches are not part of this version.
5. To post reminders, invite the bot with permission to view and send messages in the channels where Blitzcue is played. The Worker automatically uses the server channel where someone most recently played. At 9 AM Eastern, it posts the new letter and streaks from completed prior runs. Each server gets one reminder per day.

Discord's [Activity tutorial](https://discord.com/developers/docs/activities/building-an-activity) covers the portal settings and URL mapping.

To enable the typed `/blitzcue` command, deploy the Worker and run `npm run register:command`. This reads `DISCORD_BOT_TOKEN` from the ignored `.prod.vars` file, sets Discord's Interactions Endpoint URL to the deployed Worker's `/interactions` route, and registers the global command. Set `BLITZCUE_INTERACTIONS_URL` when running the command if you use a different Worker hostname. Discord sends a signed ping to confirm the endpoint, which the Worker verifies using `DISCORD_PUBLIC_KEY` in `wrangler.jsonc`. The command launches the Activity from a server channel. The existing **Launch** entry point continues to work in Discord's App Launcher.

After OAuth exchange, the Worker checks the player's Discord identity and server membership once, then signs a two hour game session. Game requests use that session so the results screen does not depend on repeated Discord API calls.

## Artwork

The web app uses `public/assets/blitzcue-mark.svg` in the header and as its favicon. The artwork sources and upload-ready PNGs are in `public/assets`:

- `blitzcue-icon.png` (1024 × 1024): upload as the Application Icon under **Settings → General Information**.
- `activity-cover.png` (1600 × 900): upload as **Cover Art** under **Activities → Art Assets**.
- `activity-background.png` (1600 × 900): upload as the **Embedded Background** under **Activities → Art Assets**.
- `blitzcue-logo.svg` and `blitzcue-logo.png`: horizontal logo for other uses.

Discord's [Activity artwork guide](https://discord.com/developers/docs/activities/development-guides/assets-and-metadata) describes the portal fields and crop requirements. The cover keeps its logo and text near the center so it also works in a narrower tile crop.

## Cloudflare deployment

The D1 database is configured in `wrangler.jsonc`. Fill in `.prod.vars`, then deploy:

```sh
cp .prod.vars.example .prod.vars
# Edit .prod.vars to add the current Discord client secret and optional bot token.
npm run deploy
```

`npm run deploy` applies pending D1 migrations, then passes the ignored `.prod.vars` file to Wrangler with `--secrets-file`, so `DISCORD_CLIENT_SECRET` is included in that deployment. If `.prod.vars` already exists, keep it and skip the copy step. `DISCORD_BOT_TOKEN` is needed for automatic reminders and command registration; game play works without it. To close public demo access after testing, set `STANDALONE_ENABLED` to `false` in `wrangler.jsonc` and deploy again. Never commit `.dev.vars`, `.prod.vars`, or Discord secrets.

The Worker serves the static app and API from one deployment. The `AI` binding in `wrangler.jsonc` connects it to Workers AI without an extra API key. D1 stores runs, names, and reminder channels. Cron runs at 13:00 and 14:00 UTC and sends only when local Eastern time is 09:00, accounting for daylight saving time.

## Answer checking

The server checks length, first letter, characters, and repeated answers before asking Cloudflare Workers AI's `@cf/meta/llama-3.1-8b-instruct-fp8-fast` whether an answer reasonably fits the category. The model must return `YES` or `NO`; an unavailable or malformed response lets the player retry the same prompt. The provider-specific call lives in `src/classifier.js`, so another model can replace it without changing the game flow. Standalone play uses the same classifier and consumes Workers AI's daily free allocation.

Block colors mark accepted answers under 10, 15, 30, 45, and 60 seconds, with a sixth color for 60 seconds or longer and gray for unanswered categories. Time on a skipped prompt is added when that prompt returns.
