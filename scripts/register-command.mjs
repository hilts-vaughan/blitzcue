const applicationId = '1553854788569927832';
const botToken = process.env.DISCORD_BOT_TOKEN;
const interactionsUrl = process.env.BLITZCUE_INTERACTIONS_URL ||
  'https://blitzcue.hilts-vaughan.workers.dev/interactions';

async function discord(path, options = {}) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    ...options,
    headers: {
      authorization: `Bot ${botToken}`,
      ...(options.body ? { 'content-type': 'application/json' } : {})
    },
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Discord API returned ${response.status}: ${result.message || 'Unknown error'}`);
  return result;
}

if (!botToken) {
  console.error('Set DISCORD_BOT_TOKEN in .prod.vars before registering /blitzcue.');
  process.exitCode = 1;
} else {
  try {
    const application = await discord('/applications/@me');
    if (application.id !== applicationId) throw new Error('The bot token belongs to a different Discord application.');
    if (application.interactions_endpoint_url !== interactionsUrl) {
      await discord('/applications/@me', {
        method: 'PATCH',
        body: JSON.stringify({ interactions_endpoint_url: interactionsUrl })
      });
      console.log(`Set Interactions Endpoint URL to ${interactionsUrl}.`);
    }
    const command = await discord(`/applications/${applicationId}/commands`, {
      method: 'POST',
      body: JSON.stringify({
      type: 1,
      name: 'blitzcue',
      description: 'Play today’s Blitzcue challenge',
      integration_types: [0],
      contexts: [0]
      })
    });
    console.log(`Registered /${command.name} globally (${command.id}).`);
  } catch (failure) {
    console.error(`Could not register /blitzcue: ${failure.message}`);
    process.exitCode = 1;
  }
}
