// A slash-command and message bot. Node 18+ (after `pnpm --filter @subspace/bot-sdk build`), Bun, or Deno:
//   BOT_TOKEN=... SUBSPACE_URL=https://subspace.click node examples/dice-bot.mjs
//   BOT_TOKEN=... deno run --allow-net --allow-env examples/dice-bot.mjs
// Optional: SUBSPACE_GATEWAY_URL (default <SUBSPACE_URL>/gateway), RELAY_ID (posts a hello there once READY),
// EXIT_AFTER_READY (seconds to stay connected, then exit).
import process from 'node:process';
import { SubspaceBot } from '@subspace/bot-sdk';

const bot = new SubspaceBot({
  token: process.env.BOT_TOKEN,
  baseUrl: process.env.SUBSPACE_URL ?? 'https://subspace.click',
  gatewayUrl: process.env.SUBSPACE_GATEWAY_URL || undefined,
});

await bot.registerCommands([
  { name: 'ping', description: 'Check the bot is alive' },
  { name: 'roll', description: 'Roll a die', options: [{ type: 'integer', name: 'sides', description: 'How many sides' }] },
]);

bot.on('ready', async () => {
  console.log(`Connected as ${bot.user?.username}`);
  if (process.env.RELAY_ID) {
    const sent = await bot.send('relay', process.env.RELAY_ID, 'Dice bot (JavaScript) is online.');
    console.log(`Posted transmission ${sent.id}`);
  }
});

bot.on('interaction', async (i) => {
  if (i.commandName === 'ping') return i.reply('Pong!');
  if (i.commandName === 'roll') {
    const sides = i.option('sides') ?? 6;
    return i.reply({ embeds: [{ title: `🎲 ${1 + Math.floor(Math.random() * sides)}`, footer: { text: `d${sides}` } }] });
  }
});

bot.on('message', (m) => {
  if (m.content === '!hello') void bot.send(m.channelType, m.channelId, `Hi ${m.author.username}!`);
});

bot.on('error', (err) => console.error('Bot error:', err));

await bot.connect();
if (process.env.EXIT_AFTER_READY) {
  await new Promise((r) => setTimeout(r, Number(process.env.EXIT_AFTER_READY) * 1000));
  bot.disconnect();
}
