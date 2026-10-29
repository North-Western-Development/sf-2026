import { useState } from 'react';
import { clsx } from 'clsx';
import { Blocks, Camera, Cloud, FileText, Image, MessagesSquare, Paperclip, Search, Vote } from 'lucide-react';
import type { Command } from './commands';
import type { AppCommand } from './appCommands';

export type SheetCommand = { kind: 'builtin'; c: Command } | { kind: 'app'; c: AppCommand };

interface AttachSheetProps {
  onFiles: (files: FileList) => void;
  onPoll?: () => void;
  onDrive?: () => void;
  onThread?: () => void;
  commands: SheetCommand[];
  onCommand: (c: Command | AppCommand) => void;
}

/**
 * The composer's + on a phone, as on Discord's app: a sheet where the keyboard was, with the
 * camera and other places to attach from, and Photos, Poll, Apps and Files along the bottom.
 * Apps swaps the sheet for a searchable list of slash commands.
 */
export function AttachSheet({ onFiles, onPoll, onDrive, onThread, commands, onCommand }: AttachSheetProps) {
  const [view, setView] = useState<'attach' | 'apps'>('attach');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase().replace(/^\//, '');
  const shown = commands.filter(({ c }) => !q || c.name.includes(q) || c.description.toLowerCase().includes(q));

  const fileInput = (label: string, accept?: string, capture?: 'environment') => (
    <input
      type="file"
      aria-label={label}
      multiple={!capture}
      accept={accept}
      capture={capture}
      hidden
      onChange={(e) => {
        if (e.target.files?.length) onFiles(e.target.files);
        e.target.value = '';
      }}
    />
  );

  return (
    <div role="dialog" aria-label={view === 'apps' ? 'Apps & Commands' : 'Attach'} data-no-swipe className={clsx('-mx-4 -mb-6 mt-3 flex flex-col rounded-t-2xl bg-raised px-3 pb-3', view === 'apps' && 'h-[min(55vh,440px)]')}>
      <div className="mx-auto mb-3 mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong" aria-hidden />
      {view === 'attach' ? (
        <div className="grid grid-cols-4 gap-2">
          <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg bg-overlay text-fg-muted active:bg-hover">
            <Camera className="h-7 w-7" aria-hidden />
            <span className="text-xs font-medium">Camera</span>
            {fileInput('Take a photo', 'image/*', 'environment')}
          </label>
          <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg bg-overlay text-fg-muted active:bg-hover">
            <Image className="h-7 w-7" aria-hidden />
            <span className="text-xs font-medium">Gallery</span>
            {fileInput('Choose from gallery', 'image/*,video/*')}
          </label>
          {onDrive && (
            <button type="button" onClick={onDrive} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg bg-overlay text-fg-muted active:bg-hover">
              <Cloud className="h-7 w-7" aria-hidden />
              <span className="text-xs font-medium">Cloud Drive</span>
            </button>
          )}
          {onThread && (
            <button type="button" onClick={onThread} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg bg-overlay text-fg-muted active:bg-hover">
              <MessagesSquare className="h-7 w-7" aria-hidden />
              <span className="text-xs font-medium">Thread</span>
            </button>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <label className="flex h-11 shrink-0 items-center gap-2 rounded-lg border border-line bg-void px-3 text-fg-muted">
            <Search className="h-5 w-5 shrink-0" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Apps & Commands"
              aria-label="Search Apps & Commands"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-subtle"
            />
          </label>
          <ul aria-label="Commands" className="mt-2 min-h-0 flex-1 overflow-y-auto">
            {shown.map(({ kind, c }) => (
              <li key={`${kind}:${'id' in c ? c.id : c.name}`}>
                <button type="button" onClick={() => onCommand(c)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left active:bg-hover">
                  {kind === 'app' && (c as AppCommand).app.iconUrl ? (
                    <img src={(c as AppCommand).app.iconUrl!} alt="" className="h-9 w-9 shrink-0 rounded-full" />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-overlay text-fg-muted">
                      <Blocks className="h-5 w-5" aria-hidden />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-fg">/{c.name}</span>
                    <span className="block truncate text-sm text-fg-subtle">
                      {kind === 'app' ? (c as AppCommand).app.name : 'Built-in'} · {c.description}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {!shown.length && <li className="px-2 py-6 text-center text-sm text-fg-subtle">No commands match.</li>}
          </ul>
        </div>
      )}

      <nav aria-label="Attach from" className="mt-3 flex justify-around rounded-2xl bg-overlay px-2 py-2">
        <SheetTab icon={Image} label="Photos" accept="image/*,video/*" onFiles={onFiles} />
        {onPoll && <SheetTab icon={Vote} label="Poll" onClick={onPoll} />}
        <SheetTab icon={Blocks} label="Apps" active={view === 'apps'} onClick={() => setView(view === 'apps' ? 'attach' : 'apps')} />
        <SheetTab icon={Paperclip} label="Files" onFiles={onFiles} />
      </nav>
    </div>
  );
}

function SheetTab({
  icon: Icon,
  label,
  active,
  onClick,
  accept,
  onFiles,
}: {
  icon: typeof FileText;
  label: string;
  active?: boolean;
  onClick?: () => void;
  accept?: string;
  onFiles?: (files: FileList) => void;
}) {
  const body = (
    <>
      <Icon className="h-6 w-6" aria-hidden />
      <span className="text-xs font-medium">{label}</span>
    </>
  );
  const cls = clsx('flex min-w-16 flex-col items-center gap-1 rounded-xl px-3 py-1.5', active ? 'bg-active text-fg' : 'text-fg-muted active:bg-hover');
  if (onFiles) {
    return (
      <label className={clsx(cls, 'cursor-pointer')}>
        {body}
        <input
          type="file"
          aria-label={label}
          multiple
          accept={accept}
          hidden
          onChange={(e) => {
            if (e.target.files?.length) onFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
    );
  }
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={cls}>
      {body}
    </button>
  );
}
