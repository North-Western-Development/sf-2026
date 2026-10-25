import { X } from 'lucide-react';
import { Tooltip } from '@subspace/ui';
import type { Embed } from '../../lib/types';
import { useChatPrefs } from '../../lib/chatPrefs';
import { confirmAction, toast } from '../../app/ui';
import { http } from '../../lib/http';
import { isTrustedLink, openLeavingDialog } from '../../lib/links';

const guardLink = (href: string) => (e: React.MouseEvent) => {
  if (isTrustedLink(href)) return;
  e.preventDefault();
  openLeavingDialog(href);
};

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function EmbedCard({ embed, onRemove }: { embed: Embed; onRemove?: () => void }) {
  const remove = onRemove && (
    <Tooltip content="Remove all embeds">
      <button
        type="button"
        aria-label="Remove all embeds"
        onClick={onRemove}
        className="absolute -right-7 top-0 rounded p-0.5 text-fg-subtle opacity-0 hover:text-fg focus:opacity-100 group-hover/embed:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </Tooltip>
  );

  // A bare image link shows just the image, like Discord.
  if (embed.type === 'image' && embed.image) {
    return (
      <div className="group/embed relative w-fit">
        <a href={embed.url} target="_blank" rel="noreferrer noopener" className="block max-w-[400px] overflow-hidden rounded-md">
          <img src={embed.image.proxyUrl} alt="" loading="lazy" className="max-h-[300px] w-auto object-contain" />
        </a>
        {remove}
      </div>
    );
  }

  const title = embed.title ?? hostOf(embed.url);
  return (
    <article
      aria-label={`Link preview: ${title}`}
      className="group/embed relative grid max-w-[432px] gap-2 rounded-[4px] border-l-4 bg-raised py-2 pl-3 pr-4"
      style={{ borderLeftColor: embed.color ?? 'var(--color-line-strong)', gridTemplateColumns: embed.thumbnail ? '1fr auto' : '1fr' }}
    >
      <div className="min-w-0 space-y-1 pt-1">
        <p className="text-xs text-fg-muted">{embed.siteName ?? hostOf(embed.url)}</p>
        <a href={embed.url} target="_blank" rel="noreferrer noopener" onClick={guardLink(embed.url)} className="block font-semibold text-brand-sky hover:underline">
          {title}
        </a>
        {embed.description && <p className="whitespace-pre-line break-words text-sm text-fg-muted">{embed.description}</p>}
        {embed.image && (
          <a href={embed.url} target="_blank" rel="noreferrer noopener" className="mt-2 block overflow-hidden rounded-[4px]">
            <img src={embed.image.proxyUrl} alt="" loading="lazy" className="max-h-[300px] w-full object-cover" />
          </a>
        )}
      </div>
      {embed.thumbnail && <img src={embed.thumbnail.proxyUrl} alt="" loading="lazy" className="mt-1 h-20 w-20 rounded-[4px] object-cover" />}
      {remove}
    </article>
  );
}

/** Link previews under a transmission. `canRemove`: the author or a moderator. */
export function Embeds({ embeds, messageId, canRemove }: { embeds: Embed[]; messageId: string; canRemove: boolean }) {
  const show = useChatPrefs((p) => p.showEmbeds);
  if (!show || !embeds.length) return null;
  const onRemove = canRemove
    ? () =>
        confirmAction({
          title: 'Remove Embeds',
          body: 'Are you sure you want to remove all embeds on this transmission? This cannot be undone.',
          confirmLabel: 'Remove All',
          danger: true,
          onConfirm: () => http.delete(`/transmissions/${messageId}/embeds`).then(() => undefined, () => toast('Could not remove embeds', 'error')),
        })
    : undefined;
  return (
    <div className="mt-1 flex flex-col gap-1 pr-8">
      {embeds.map((e, i) => (
        <EmbedCard key={`${e.url}-${i}`} embed={e} onRemove={i === 0 ? onRemove : undefined} />
      ))}
    </div>
  );
}
