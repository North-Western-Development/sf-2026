import { http } from '../../lib/http';

/**
 * Built-in slash commands, the apps every relay has (Discord's /shrug, /tableflip, /me, /spoiler,
 * /nick, /thread, /giphy). Typing "/" in the message box lists them; "Use Apps" opens the list.
 */
export interface CommandContext {
  beaconId?: string;
  /** A text relay a thread can be started in. */
  threadRelayId?: string;
  send: (content: string) => void;
  startThread: (name: string) => Promise<void>;
  toast: (message: string, tone?: 'info' | 'error' | 'success') => void;
}

export interface Command {
  name: string;
  description: string;
  /** Shown after the name: what the argument is. */
  arg?: string;
  /** Hidden where it cannot work (e.g. /nick outside a beacon). */
  available?: (ctx: CommandContext) => boolean;
  run: (arg: string, ctx: CommandContext) => Promise<void> | void;
}

const append = (face: string) => (arg: string, ctx: CommandContext) => ctx.send(arg ? `${arg} ${face}` : face);

export const COMMANDS: Command[] = [
  { name: 'shrug', description: 'Appends ¯\\_(ツ)_/¯ to your transmission.', arg: 'message', run: append('¯\\_(ツ)_/¯') },
  { name: 'tableflip', description: 'Appends (╯°□°)╯︵ ┻━┻ to your transmission.', arg: 'message', run: append('(╯°□°)╯︵ ┻━┻') },
  { name: 'unflip', description: 'Appends ┬─┬ノ( º _ ºノ) to your transmission.', arg: 'message', run: append('┬─┬ノ( º _ ºノ)') },
  { name: 'lenny', description: 'Appends ( ͡° ͜ʖ ͡°) to your transmission.', arg: 'message', run: append('( ͡° ͜ʖ ͡°)') },
  {
    name: 'me',
    description: 'Displays text with emphasis.',
    arg: 'action',
    run: (arg, ctx) => {
      if (arg) ctx.send(`_${arg.replace(/_/g, '\\_')}_`);
    },
  },
  {
    name: 'spoiler',
    description: 'Marks your transmission as a spoiler.',
    arg: 'message',
    run: (arg, ctx) => {
      if (arg) ctx.send(`||${arg}||`);
    },
  },
  {
    name: 'nick',
    description: 'Changes your nickname in this beacon (leave empty to reset).',
    arg: 'new nickname',
    available: (ctx) => !!ctx.beaconId,
    run: async (arg, ctx) => {
      try {
        await http.patch(`/beacons/${ctx.beaconId}/members/@me`, { nickname: arg.trim().slice(0, 32) || null });
        ctx.toast(arg.trim() ? `Your nickname is now ${arg.trim().slice(0, 32)}.` : 'Your nickname was reset.', 'success');
      } catch (err) {
        ctx.toast((err as Error).message, 'error');
      }
    },
  },
  {
    name: 'thread',
    description: 'Starts a thread in this relay.',
    arg: 'name',
    available: (ctx) => !!ctx.threadRelayId,
    run: async (arg, ctx) => {
      try {
        await ctx.startThread(arg.trim() || 'New Thread');
      } catch (err) {
        ctx.toast((err as Error).message, 'error');
      }
    },
  },
  {
    name: 'giphy',
    description: 'Sends the top GIF for a search.',
    arg: 'search',
    run: async (arg, ctx) => {
      if (!arg.trim()) return;
      try {
        const r = await http.get<{ gifs: Array<{ url: string }> }>(`/gifs/search?q=${encodeURIComponent(arg.trim())}`);
        if (r.gifs[0]) ctx.send(r.gifs[0].url);
        else ctx.toast(`No GIFs for “${arg.trim()}”.`);
      } catch (err) {
        ctx.toast((err as Error).message, 'error');
      }
    },
  },
];

/** "/name arg" → the command and its argument, if it is one of ours. */
export function parseCommand(text: string, ctx: CommandContext): { command: Command; arg: string } | null {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  const command = COMMANDS.find((c) => c.name === m[1].toLowerCase() && (c.available?.(ctx) ?? true));
  return command ? { command, arg: m[2] ?? '' } : null;
}

/** Commands to suggest while the box holds "/partial" (nothing typed after the name yet). */
export function matchCommands(text: string, ctx: CommandContext): Command[] {
  const m = /^\/([a-z]*)$/i.exec(text);
  if (!m) return [];
  return COMMANDS.filter((c) => c.name.startsWith(m[1].toLowerCase()) && (c.available?.(ctx) ?? true));
}
