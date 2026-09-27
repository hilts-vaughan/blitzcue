const applicationId = '1553854788569927832';
const botToken = process.env.DISCORD_BOT_TOKEN;

if (!botToken) {
  console.error('Set DISCORD_BOT_TOKEN in .prod.vars before registering /blitzcue.');
  process.exitCode = 1;
} else {
  const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
    method: 'POST',
    headers: {
      authorization: `Bot ${botToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      type: 1,
      name: 'blitzcue',
      description: 'Play today’s Blitzcue challenge',
      integration_types: [0],
      contexts: [0]
    }),
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json();
  if (!response.ok) {
    console.error(`Discord rejected /blitzcue (${response.status}): ${result.message || 'Unknown error'}`);
    process.exitCode = 1;
  } else {
    console.log(`Registered /${result.name} globally (${result.id}).`);
  }
}
