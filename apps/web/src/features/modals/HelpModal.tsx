import { useState } from 'react';
import { clsx } from 'clsx';
import { Modal } from '@subspace/ui';
import { SUBSPACE_DIRECTIVES } from '@subspace/constants';
import { closeModal, openModal } from '../../app/ui';
import { KEYBINDS } from '../../lib/keybinds';
import { term } from '../../lib/strings';
import { Markdown } from '../chat/markdown';

/** The formatting Subspace understands, each shown as typed and as it renders. */
const FORMATTING: Array<[string, string]> = [
  ['**bold**', 'Bold'],
  ['*italic* or _italic_', 'Italic'],
  ['__underline__', 'Underline'],
  ['~~strikethrough~~', 'Strikethrough'],
  ['||spoiler||', 'Spoiler (click to reveal)'],
  ['`inline code`', 'Inline code'],
  ['```js\nconst x = 1;\n```', 'Code block with highlighting'],
  ['> quote', 'Quote one line'],
  ['>>> quote', 'Quote the rest of the transmission'],
  ['# Heading', 'Headings (#, ##, ###)'],
  ['-# small text', 'Subtext'],
  ['- item\n  - nested', 'Lists (indent to nest)'],
  ['[link text](https://example.com)', 'Masked link'],
  ['<t:1800000000:R>', 'Timestamp in each reader’s time zone'],
];

type Tab = 'shortcuts' | 'formatting' | 'about';

/** Discord's Help: keyboard shortcuts, how to format text, and where to go next. */
export function HelpModal({ tab: initial = 'shortcuts' }: { tab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial);
  return (
    <Modal isOpen onClose={closeModal} title="Help" maxWidth="2xl">
      <div role="tablist" aria-label="Help topics" className="mb-4 flex gap-1">
        {(
          [
            ['shortcuts', 'Keyboard Shortcuts'],
            ['formatting', 'Formatting'],
            ['about', `About ${term('beacon', true)}`],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={clsx('rounded-md px-3 py-1.5 text-sm font-medium', tab === key ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover')}>
            {label}
          </button>
        ))}
      </div>
      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {tab === 'shortcuts' && (
          <dl className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {KEYBINDS.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 bg-raised px-4 py-2.5">
                <dt className="text-sm text-fg">{v}</dt>
                <dd>
                  <kbd className="whitespace-nowrap rounded-md border border-line-strong bg-void px-2 py-1 font-mono text-xs text-fg">{k}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        )}
        {tab === 'formatting' && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-fg-subtle">
                <th className="pb-2 font-semibold">Type</th>
                <th className="pb-2 font-semibold">To get</th>
              </tr>
            </thead>
            <tbody>
              {FORMATTING.map(([src, label]) => (
                <tr key={src} className="border-t border-line align-top">
                  <td className="py-2 pr-4">
                    <pre className="whitespace-pre-wrap font-mono text-xs text-fg-muted">{src}</pre>
                  </td>
                  <td className="py-2">
                    <div className="text-fg">
                      <Markdown content={src} />
                    </div>
                    <p className="text-xs text-fg-subtle">{label}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'about' && (
          <div className="space-y-4 text-sm text-fg-muted">
            <p>
              Subspace is a place for {term('beacon', true).toLowerCase()} (servers), {term('relay', true).toLowerCase()} (channels), {term('link', true).toLowerCase()} (direct messages) and{' '}
              {term('commLink', true).toLowerCase()} (voice). Ctrl + K jumps anywhere.
            </p>
            <div>
              <p className="mb-1 font-semibold text-fg">Subspace Directives</p>
              <ul className="list-disc space-y-1 pl-5">
                {SUBSPACE_DIRECTIVES.rules.map((d) => (
                  <li key={d.title}>
                    <span className="font-medium text-fg">{d.title}.</span> {d.body}
                  </li>
                ))}
              </ul>
            </div>
            <p>
              Something wrong? Report a transmission, transmitter or {term('beacon').toLowerCase()} from its menu, or{' '}
              <button type="button" className="text-brand-sky hover:underline" onClick={() => openModal({ kind: 'userSettings', tab: 'account' })}>
                check your Account Standing
              </button>
              .
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
