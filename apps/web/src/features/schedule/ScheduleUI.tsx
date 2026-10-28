import { useState, type FormEvent } from 'react';
import { CalendarClock, Clock, Send, Trash2, WifiOff } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button, Modal, Tooltip } from '@subspace/ui';
import { toast } from '../../app/ui';
import type { ChannelKey } from '../../lib/types';
import { cancelScheduled, schedule, sendScheduledNow, useScheduled } from './scheduled';

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
/** A <input type="datetime-local"> value for a time. */
const localInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

/** The composer's clock button: schedule what is typed for later, on this device. */
export function ScheduleButton({ channelKey, text, disabled, onScheduled }: { channelKey: ChannelKey; text: string; disabled?: boolean; onScheduled: () => void }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(() => localInput(Date.now() + 3_600_000));
  const [whenAvailable, setWhenAvailable] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const ms = new Date(at).getTime();
    if (Number.isNaN(ms) || ms < Date.now() + 30_000) return toast('Pick a time at least a minute from now', 'error');
    schedule(channelKey, text.trim(), ms, whenAvailable);
    onScheduled();
    setOpen(false);
    toast(`Scheduled for ${when(ms)}`, 'success');
  };
  return (
    <>
      <Tooltip content="Schedule transmission">
        <button type="button" aria-label="Schedule transmission" disabled={disabled} onClick={() => setOpen(true)} className="flex h-7 w-7 items-center justify-center text-fg-muted hover:text-fg disabled:opacity-40">
          <CalendarClock className="h-5 w-5" />
        </button>
      </Tooltip>
      {open && (
        <Modal
          isOpen
          onClose={() => setOpen(false)}
          title="Schedule Transmission"
          description="It is sent from this device, which has to be online at that time."
          maxWidth="md"
        >
          <form onSubmit={submit} className="space-y-4">
            <p className="line-clamp-3 rounded-md bg-void px-3 py-2 text-sm text-fg [overflow-wrap:anywhere]">{text.trim()}</p>
            <label className="block text-xs font-bold uppercase text-fg-muted">
              Send at
              <input
                type="datetime-local"
                aria-label="Send at"
                value={at}
                min={localInput(Date.now() + 60_000)}
                onChange={(e) => setAt(e.target.value)}
                required
                className="mt-1.5 h-10 w-full rounded-md border border-line bg-void px-3 text-sm normal-case text-fg"
              />
            </label>
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1" checked={whenAvailable} onChange={(e) => setWhenAvailable(e.target.checked)} />
              <span>
                <span className="block text-sm font-medium text-fg">Send when available</span>
                <span className="block text-xs text-fg-subtle">If this device is offline (or the app is closed) at that time, send it as soon as it is back. Otherwise it stays unsent at the end of the chat.</span>
              </span>
            </label>
            <div className="-mx-6 -mb-4 mt-6 flex justify-end gap-3 bg-raised px-6 py-4">
              <Button variant="link" className="text-fg" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Schedule</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

/** At the end of a chat: its scheduled transmissions, and those that could not be sent, greyed out. */
export function ScheduledFeed({ channelKey }: { channelKey: ChannelKey }) {
  const items = useScheduled(useShallow((s) => s.items.filter((i) => i.key === channelKey)));
  if (!items.length) return null;
  return (
    <ul aria-label="Scheduled transmissions" className="space-y-1 px-4 pb-2 pt-1">
      {items.map((i) => (
        <li key={i.id} aria-label={i.status === 'unsent' ? 'Unsent transmission' : 'Scheduled transmission'} className="flex items-start gap-3 rounded-md px-2 py-1.5 opacity-60 hover:bg-hover/40 hover:opacity-90">
          {i.status === 'unsent' ? <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden /> : <Clock className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" aria-hidden />}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-fg-muted">
              {i.status === 'unsent' ? `Not sent: this device was offline at ${when(i.sendAt)}` : i.status === 'sending' ? 'Sending…' : `Scheduled for ${when(i.sendAt)}${i.whenAvailable ? ' · sends when available' : ''}`}
            </p>
            <p className="whitespace-pre-wrap text-sm text-fg [overflow-wrap:anywhere]">{i.content}</p>
          </div>
          <Tooltip content="Send now">
            <button type="button" aria-label="Send now" disabled={i.status === 'sending'} onClick={() => void sendScheduledNow(i.id)} className="rounded-md p-1 text-fg-muted hover:bg-hover hover:text-fg">
              <Send className="h-4 w-4" />
            </button>
          </Tooltip>
          <Tooltip content={i.status === 'unsent' ? 'Delete' : 'Cancel'}>
            <button type="button" aria-label={i.status === 'unsent' ? 'Delete unsent transmission' : 'Cancel scheduled transmission'} onClick={() => cancelScheduled(i.id)} className="rounded-md p-1 text-fg-muted hover:bg-hover hover:text-danger">
              <Trash2 className="h-4 w-4" />
            </button>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}
