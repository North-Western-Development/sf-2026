import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { ImagePlus, MapPin, Volume2, X } from 'lucide-react';
import { Button, Input, Modal } from '@subspace/ui';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../data/store';
import { upsertEvent, useCommunity, type BeaconEvent } from '../../data/community';
import { closeModal, openModal, toast } from '../../app/ui';
import { http } from '../../lib/http';
import { pickImage, uploadMedia } from '../../lib/media';
import { term } from '../../lib/strings';
import type { Relay } from '../../lib/types';
import { EventCard } from './EventsModal';

const pad = (n: number) => String(n).padStart(2, '0');
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const combine = (date: string, time: string) => (date && time ? new Date(`${date}T${time}`) : null);

/** The next whole hour, at least 30 minutes away. */
function defaultStart() {
  const d = new Date(Date.now() + 30 * 60_000);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

const STEPS = ['Location', 'Event Info', 'Review'] as const;

/** Discord's three-step event wizard: where, what and when, then a preview. Also edits. */
export function CreateEventModal({ beaconId, eventId }: { beaconId: string; eventId?: string }) {
  const existing = useCommunity((s) => (eventId ? s.events[beaconId]?.find((e) => e.id === eventId) : undefined));
  const commLinks = useStore(useShallow((s) => (s.relayIdsByBeacon[beaconId] ?? []).map((id) => s.relays[id]).filter((r): r is Relay => r?.type === 'comm_link')));
  const me = useStore((s) => s.me);
  const start0 = existing ? new Date(existing.startAt) : defaultStart();
  const end0 = existing?.endAt ? new Date(existing.endAt) : null;

  const [step, setStep] = useState(0);
  const [locationType, setLocationType] = useState<'comm_link' | 'external'>(existing?.locationType ?? 'comm_link');
  const [relayId, setRelayId] = useState(existing?.relayId ?? commLinks[0]?.id ?? '');
  const [location, setLocation] = useState(existing?.location ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [startDate, setStartDate] = useState(dateValue(start0));
  const [startTime, setStartTime] = useState(timeValue(start0));
  const [endDate, setEndDate] = useState(end0 ? dateValue(end0) : '');
  const [endTime, setEndTime] = useState(end0 ? timeValue(end0) : '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [coverUrl, setCoverUrl] = useState<string | null>(existing?.coverUrl ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = combine(startDate, startTime);
  const end = combine(endDate, endTime);
  const needsEnd = locationType === 'external';

  // What each step needs before Next.
  const problem = useMemo(() => {
    if (step === 0) {
      if (locationType === 'comm_link' && !relayId) return `Pick a ${term('commLink')}`;
      if (locationType === 'external' && !location.trim()) return 'Say where it is';
    }
    if (step === 1) {
      if (!name.trim()) return 'Give it a topic';
      if (!start) return 'Pick a start time';
      if (!existing && start.getTime() < Date.now()) return 'The start time is in the past';
      if (needsEnd && !end) return 'Events somewhere else need an end time';
      if (end && start && end <= start) return 'The end must be after the start';
    }
    return null;
  }, [step, locationType, relayId, location, name, start, end, needsEnd, existing]);

  const draft: BeaconEvent = {
    id: existing?.id ?? 'preview',
    beaconId,
    name: name.trim() || 'Untitled event',
    description: description.trim() || null,
    locationType,
    relayId: locationType === 'comm_link' ? relayId : null,
    location: locationType === 'external' ? location.trim() : null,
    coverUrl,
    startAt: (start ?? new Date()).toISOString(),
    endAt: end?.toISOString() ?? null,
    status: existing?.status ?? 'scheduled',
    creator: existing?.creator ?? (me ? { id: me.id, username: me.username, displayName: me.displayName, avatarUrl: me.avatarUrl } : null),
    interestedCount: existing?.interestedCount ?? 1,
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    const body = {
      name: draft.name,
      description: draft.description,
      locationType,
      relayId: draft.relayId,
      location: draft.location,
      coverUrl,
      ...(existing && existing.startAt === draft.startAt ? {} : { startAt: draft.startAt }),
      endAt: draft.endAt,
    };
    try {
      const res = existing
        ? await http.patch<{ event: BeaconEvent }>(`/beacons/${beaconId}/events/${existing.id}`, body)
        : await http.post<{ event: BeaconEvent }>(`/beacons/${beaconId}/events`, body);
      upsertEvent(res.event);
      toast(existing ? 'Event updated' : 'Event created', 'success');
      openModal({ kind: 'events', beaconId });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addCover = async () => {
    const file = await pickImage();
    if (!file) return;
    try {
      setCoverUrl(await uploadMedia('beacon_banner', file));
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <Modal
      isOpen
      onClose={closeModal}
      maxWidth="lg"
      title={step === 0 ? "Where's your event?" : step === 1 ? "What's your event about?" : "Here's a preview of your event"}
      description={step === 0 ? 'So no one gets lost on where to go.' : step === 1 ? 'Fill out the details of your event.' : 'This event will show up for everyone who can see it.'}
      footer={
        <div className="flex w-full items-center">
          {step > 0 ? (
            <Button variant="link" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          ) : (
            <Button variant="link" onClick={() => openModal({ kind: 'events', beaconId })}>
              Cancel
            </Button>
          )}
          <span className="ml-auto mr-3 text-sm text-danger">{error ?? (problem && step < 2 ? '' : '')}</span>
          {step < 2 ? (
            <Button disabled={!!problem} onClick={() => setStep(step + 1)}>
              Next
            </Button>
          ) : (
            <Button isLoading={busy} onClick={() => void submit()}>
              {existing ? 'Save Event' : 'Create Event'}
            </Button>
          )}
        </div>
      }
    >
      <ol className="mb-5 flex gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined} className="flex-1">
            <span className={clsx('block h-1 rounded-full', i <= step ? 'bg-brand' : 'bg-line')} />
            <span className={clsx('mt-1 block text-xs', i === step ? 'font-semibold text-fg' : 'text-fg-subtle')}>{s}</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-3" role="radiogroup" aria-label="Location">
          <LocationOption
            checked={locationType === 'comm_link'}
            onSelect={() => setLocationType('comm_link')}
            icon={<Volume2 className="h-5 w-5" />}
            title={term('commLink')}
            hint="Hang out with voice, video and Holo-Cast."
          />
          {locationType === 'comm_link' && (
            <label className="block pl-1">
              <span className="mb-1.5 block text-xs font-bold uppercase text-fg-muted">Select a {term('commLink')}</span>
              <select value={relayId} onChange={(e) => setRelayId(e.target.value)} aria-label={`Select a ${term('commLink')}`} className="h-10 w-full rounded-md border border-line bg-void px-2 text-sm text-fg">
                {commLinks.length === 0 && <option value="">No {term('commLink', true)} yet</option>}
                {commLinks.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <LocationOption checked={locationType === 'external'} onSelect={() => setLocationType('external')} icon={<MapPin className="h-5 w-5" />} title="Somewhere Else" hint="A link, an address, or another app." />
          {locationType === 'external' && (
            <div className="pl-1">
              <Input label="Enter a location" value={location} maxLength={100} onChange={(e) => setLocation(e.target.value)} placeholder="Add a location, link, or something." />
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <Input label="Event Topic" required value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="What's your event?" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Start Date" required type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Input label="Start Time" required type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            <Input label={needsEnd ? 'End Date' : 'End Date (optional)'} required={needsEnd} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <Input label={needsEnd ? 'End Time' : 'End Time (optional)'} required={needsEnd} type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold uppercase text-fg-muted">Description</span>
            <textarea
              value={description}
              maxLength={1000}
              rows={4}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell people a little more about your event."
              className="w-full resize-none rounded-md border border-line bg-void px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-brand"
            />
          </label>
          <div>
            <span className="mb-1.5 block text-xs font-bold uppercase text-fg-muted">Cover Image</span>
            {coverUrl ? (
              <div className="relative">
                <img src={coverUrl} alt="Cover" className="h-28 w-full rounded-md object-cover" />
                <button type="button" aria-label="Remove cover image" onClick={() => setCoverUrl(null)} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-void/80 text-fg hover:bg-void">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => void addCover()}>
                <ImagePlus className="h-4 w-4" /> Upload Image
              </Button>
            )}
          </div>
          {problem && <p className="text-sm text-danger">{problem}</p>}
        </div>
      )}

      {step === 2 && <EventCard event={draft} preview />}
    </Modal>
  );
}

function LocationOption({ checked, onSelect, icon, title, hint }: { checked: boolean; onSelect: () => void; icon: React.ReactNode; title: string; hint: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={clsx('flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left ring-1', checked ? 'bg-brand/10 ring-brand' : 'bg-raised ring-line hover:bg-hover')}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-overlay text-fg-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-fg">{title}</span>
        <span className="block text-sm text-fg-muted">{hint}</span>
      </span>
      <span className={clsx('h-5 w-5 rounded-full ring-2', checked ? 'bg-brand ring-brand' : 'ring-fg-subtle')} />
    </button>
  );
}
