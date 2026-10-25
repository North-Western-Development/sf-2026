import { useNavigate } from 'react-router';
import { CornerUpRight } from 'lucide-react';
import { useStore } from '../../data/store';
import type { Transmission } from '../../lib/types';
import { formatMessageTime } from '../../lib/time';
import { term } from '../../lib/strings';
import { Markdown } from './markdown';
import { useMarkdownResolvers } from './resolvers';
import { Attachments } from './Attachments';

/** How a forwarded transmission reads: marked Forwarded, the original, and where it came from. */
export function ForwardedBox({ forwarded, beaconId, filter = false }: { forwarded: NonNullable<Transmission['forwarded']>; beaconId?: string; filter?: boolean }) {
  const navigate = useNavigate();
  const resolvers = useMarkdownResolvers(beaconId);
  const canOpen = useStore((s) => (forwarded.source.channelType === 'relay' ? !!s.relays[forwarded.source.channelId] : forwarded.source.channelType === 'link' ? !!s.links[forwarded.source.channelId] : true));
  const open = () => {
    const src = forwarded.source;
    if (src.channelType === 'relay' && src.beaconId) navigate(`/channels/${src.beaconId}/${src.channelId}?m=${src.transmissionId}`);
    else if (src.channelType !== 'thread') navigate(`/channels/@me/${src.channelId}?m=${src.transmissionId}`);
  };
  return (
    <div aria-label="Forwarded transmission" role="group" className="mt-1 max-w-[560px] border-l-4 border-line-strong pl-3">
      <p className="flex items-center gap-1 text-xs italic text-fg-subtle">
        <CornerUpRight className="h-3.5 w-3.5" /> Forwarded
      </p>
      {forwarded.content && (
        <div className="text-[15px] leading-[22px] text-fg">
          <Markdown content={forwarded.content} resolvers={resolvers} />
        </div>
      )}
      {!!forwarded.stickers?.length && (
        <div className="mt-1 flex gap-2">
          {forwarded.stickers.map((st, i) => (
            <img key={`${st.id}-${i}`} src={st.url} alt={`Sticker ${st.name}`} className="h-40 w-40 object-contain" />
          ))}
        </div>
      )}
      <Attachments items={forwarded.attachments} filter={filter} />
      <p className="mt-1 text-xs text-fg-subtle">
        {forwarded.source.name && canOpen ? (
          <button type="button" onClick={open} className="hover:underline">
            #{forwarded.source.name}
          </button>
        ) : forwarded.source.channelType !== 'relay' && canOpen ? (
          <button type="button" onClick={open} className="hover:underline">
            {term('link')}
          </button>
        ) : null}
        {(forwarded.source.name || forwarded.source.channelType !== 'relay') && canOpen ? ' · ' : ''}
        {formatMessageTime(forwarded.createdAt)}
      </p>
    </div>
  );
}
