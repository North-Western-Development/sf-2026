import { resolveBotIntents } from '@subspace/database';

/**
 * The Message Content intent over REST, as the gateway applies it (forBot in gateway-service): a
 * bot without it reads what was said only in transmissions that mention it, its own, and those in
 * Direct Links and meshes. Everything else comes back with the text, files, embeds, stickers,
 * polls, reply snippets and forwarded text left out.
 */
export async function redactForBot<T extends Record<string, any>>(db: any, token: { bot?: boolean; transmitterId: string } | null | undefined, channelType: string, list: T[]): Promise<T[]> {
  if (!token?.bot || channelType === 'link' || channelType === 'mesh') return list;
  const { messageContent } = await resolveBotIntents(db, token.transmitterId);
  if (messageContent) return list;
  return list.map((t) => {
    const mine = t.author?.id === token.transmitterId || t.transmitterId === token.transmitterId;
    const mentioned = Array.isArray(t.mentions) && t.mentions.includes(token.transmitterId);
    if (mine || mentioned) return t;
    return {
      ...t,
      content: '',
      embeds: [],
      attachments: [],
      stickers: [],
      poll: null,
      ...(t.forwarded ? { forwarded: { ...t.forwarded, content: '', attachments: [], stickers: [] } } : {}),
      ...(t.replyTo && typeof t.replyTo === 'object' ? { replyTo: { ...t.replyTo, content: '' } } : {}),
    };
  });
}
