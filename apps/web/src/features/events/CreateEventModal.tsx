import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { CalendarDays, MapPin, Pencil, Podcast, Volume2 } from 'lucide-react';
import { Button, Modal } from '@subspace/ui';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../data/store';
import { upsertEvent, useCommunity, type BeaconEvent, type Recurrence } from '../../data/community';
import { closeModal, openModal, toast } from '../../app/ui';
import { http } from '../../lib/http';
import { pickImage, uploadMedia } from '../../lib/media';
import { term } from '../../lib/strings';
import type { Relay } from '../../lib/types';
import { Dropdown } from '../common/Dropdown';
import { ImageCropDialog } from '../common/ImageCropDialog';
import { EventCard } from './EventsModal';

const pad = (n: number) => String(n).padStart(2, '0');
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const combine = (date: string, time: string) => (date && time ? new Date(`${date}T${time}`) : null);

/** Every 15 minutes of the day, labelled in the viewer's clock ("8:00 PM"). */
const TIMES = Array.from({ length: 96 }, (_, i) => {
  const d = new Date(2000, 0, 1, Math.floor(i / 4), (i % 4) * 15);
  return { value: timeValue(d), label: d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) };
});

/** The next quarter hour at least 15 minutes away. */
function defaultStart() {
  const d = new Date(Date.now() + 15 * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return d;
}

const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth'];
/** Discord's frequency labels for a given start date. */
function recurrenceOptions(start: Date): Array<{ value: Recurrence; label: string }> {
  const weekday = start.toLocaleDateString(undefined, { weekday: 'long' });
  const nth = ORDINAL[Math.ceil(start.getDate() / 7) - 1];
  return [
    { value: 'none', label: 'Does not repeat' },
    { value: 'weekly', label: `Weekly on ${weekday}` },
    { value: 'biweekly', label: `Every other ${weekday}` },
    { value: 'monthly', label: `Monthly on the ${nth} ${weekday}` },
    { value: 'yearly', label: `Annually on ${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` },
    { value: 'weekdays', label: 'Every weekday (Monday to Friday)' },
  ];
}

const STEPS = ['Location', 'Event Info', 'Review'] as const;
const COVER_ASPECT = 2.5; // 800 x 320, as Discord recommends

/** Discord's three-step event wizard: where, what and when, then a preview. Also edits. */
export function CreateEventModal({ beaconId, eventId }: { beaconId: string; eventId?: string }) {
  const existing = useCommunity((s) => (eventId ? s.events[beaconId]?.find((e) => e.id === eventId) : undefined));
  const voiceRelays = useStore(useShallow((s) => (s.relayIdsByBeacon[beaconId] ?? []).map((id) => s.relays[id]).filter((r): r is Relay => r?.type === 'comm_link' || r?.type === 'stage')));
  const me = useStore((s) => s.me);
  const start0 = existing ? new Date(existing.startAt) : defaultStart();
  const end0 = existing?.endAt ? new Date(existing.endAt) : null;

  const [step, setStep] = useState(0);
  const [locationType, setLocationType] = useState<'comm_link' | 'stage' | 'external'>(existing?.locationType ?? 'comm_link');
  const [relayId, setRelayId] = useState(existing?.relayId ?? voiceRelays.find((r) => r.type === 'comm_link')?.id ?? '');
  const choices = voiceRelays.filter((r) => r.type === locationType);
  const place = locationType === 'stage' ? 'Stage' : term('commLink');
  const pick = (t: 'comm_link' | 'stage' | 'external') => {
    setLocationType(t);
    if (t !== 'external') setRelayId(voiceRelays.find((r) => r.type === t)?.id ?? '');
  };
  const [location, setLocation] = useState(existing?.location ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [startDate, setStartDate] = useState(dateValue(start0));
  const [startTime, setStartTime] = useState(timeValue(start0));
  const [endDate, setEndDate] = useState(end0 ? dateValue(end0) : dateValue(start0));
  const [endTime, setEndTime] = useState(end0 ? timeValue(end0) : timeValue(new Date(start0.getTime() + 3_600_000)));
  const [recurrence, setRecurrence] = useState<Recurrence>(existing?.recurrence ?? 'none');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [coverUrl, setCoverUrl] = useState<string | null>(existing?.coverUrl ?? null);
  const [cropping, setCropping] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const external = locationType === 'external';
  const start = combine(startDate, startTime);
  const end = external ? combine(endDate, endTime) : null;

  // What each step needs before Next.
  const problem = useMemo(() => {
    if (step === 0) {
      if (!external && !relayId) return `Pick a ${place}`;
      if (external && !location.trim()) return 'Say where it is';
    }
    if (step === 1) {
      if (!name.trim()) return 'Give it a topic';
      if (!start) return 'Pick a start time';
      if (!existing && start.getTime() < Date.now()) return 'The start time is in the past';
      if (external && !end) return 'Pick an end time';
      if (end && start && end <= start) return 'The end must be after the start';
    }
    return null;
  }, [step, external, relayId, location, name, start, end, existing]);

  const draft: BeaconEvent = {
    id: existing?.id ?? 'preview',
    beaconId,
    name: name.trim() || 'Untitled event',
    description: description.trim() || null,
    locationType,
    relayId: external ? null : relayId,
    location: external ? location.trim() : null,
    coverUrl,
    startAt: (start ?? new Date()).toISOString(),
    endAt: end?.toISOString() ?? null,
    status: existing?.status ?? 'scheduled',
    recurrence,
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
      recurrence,
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

  const chooseCover = async () => {
    const file = await pickImage();
    if (file) setCropping(file);
  };
  const applyCover = async (file: File) => {
    setCropping(null);
    try {
      setCoverUrl(await uploadMedia('beacon_banner', file));
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const titles = [
    ['Where is your event?', 'So no one gets lost on where to go.'],
    ["What's your event about?", 'Fill out the details of your event.'],
  ] as const;
  const cancel = () => openModal({ kind: 'events', beaconId });

  return (
    <Modal
      isOpen
      onClose={closeModal}
      ariaLabel={step < 2 ? titles[step][0] : "Here's a preview of your event"}
      maxWidth="lg"
      footer={
        <div className="flex w-full items-center gap-2">
          {step > 0 && (
            <Button variant="link" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={cancel}>
              Cancel
            </Button>
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
        </div>
      }
    >
      <ol className="mb-5 flex gap-2 pr-8" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined} className="flex-1">
            <span className={clsx('block h-1 rounded-full', i <= step ? 'bg-brand' : 'bg-fg-subtle/40')} />
            <span className={clsx('mt-1.5 block text-xs', i === step ? 'text-brand-sky' : 'text-fg-subtle')}>{s}</span>
          </li>
        ))}
      </ol>

      {step < 2 && (
        <header className="mb-5">
          <h2 className="text-2xl font-bold text-fg">{titles[step][0]}</h2>
          <p className="mt-1 text-sm text-fg-muted">{titles[step][1]}</p>
        </header>
      )}

      {step === 0 && (
        <div className="space-y-5">
          <div role="radiogroup" aria-label="Location" className="space-y-4">
            <LocationOption checked={locationType === 'stage'} onSelect={() => pick('stage')} icon={<Podcast />} title="Stage" hint="Great for talks and Q&A: speakers talk, the audience listens." />
            <LocationOption checked={locationType === 'comm_link'} onSelect={() => pick('comm_link')} icon={<Volume2 />} title={term('commLink')} hint="Hang out with voice, video and Holo-Cast." />
            <LocationOption checked={external} onSelect={() => pick('external')} icon={<MapPin />} title="Somewhere Else" hint="Text relay, external link, or in-person location." />
          </div>
          {!external ? (
            <Dropdown
              label={`Select a ${place}`}
              required
              value={relayId}
              placeholder={choices.length ? 'Select…' : locationType === 'stage' ? 'No Stages yet' : `No ${term('commLink', true)} yet`}
              onChange={setRelayId}
              options={choices.map((r) => ({ value: r.id, label: r.name, icon: r.type === 'stage' ? <Podcast /> : <Volume2 /> }))}
            />
          ) : (
            <Field label="Enter a location" required>
              <input value={location} maxLength={100} onChange={(e) => setLocation(e.target.value)} placeholder="Add a location, link, or something." className={inputCls} />
            </Field>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <Field label="Event Topic" required>
            <input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="What's your event?" aria-label="Event Topic" className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start Date" required>
              <DateInput value={startDate} onChange={setStartDate} label="Start Date" />
            </Field>
            <Dropdown label="Start Time" required value={startTime} onChange={setStartTime} options={TIMES} />
            {external && (
              <>
                <Field label="End Date" required>
                  <DateInput value={endDate} onChange={setEndDate} label="End Date" />
                </Field>
                <Dropdown label="End Time" required value={endTime} onChange={setEndTime} options={TIMES} />
              </>
            )}
          </div>
          <Dropdown label="Event Frequency" required value={recurrence} onChange={setRecurrence} options={recurrenceOptions(start ?? new Date())} />
          <Field label="Description">
            <textarea
              value={description}
              maxLength={1000}
              rows={4}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell people a little more about your event. Markdown, new lines, and links are supported."
              aria-label="Description"
              className={clsx(inputCls, 'h-auto resize-none py-2.5')}
            />
          </Field>
          <div>
            <span className="block text-sm font-semibold text-fg">Cover Image</span>
            <span className="mb-2 block text-xs text-fg-muted">We recommend an image that's at least 800px wide and 320px tall.</span>
            {coverUrl ? (
              <>
                <div className="relative overflow-hidden rounded-lg ring-1 ring-line">
                  <img src={coverUrl} alt="Cover" className="aspect-[5/2] w-full object-cover" />
                  <button type="button" aria-label="Change cover image" onClick={() => void chooseCover()} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-void/80 text-fg hover:bg-void">
                    <Pencil className="h-4 w-4" />
                  </button>
                </div>
                <Button size="sm" className="mt-2" onClick={() => setCoverUrl(null)}>
                  Remove Image
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => void chooseCover()}>
                Upload Cover Image
              </Button>
            )}
          </div>
          {problem && <p className="text-sm text-danger">{problem}</p>}
        </div>
      )}

      {step === 2 && (
        <>
          <EventCard event={draft} preview />
          <div className="mt-6 text-center">
            <p className="text-xl font-bold text-fg">Here's a preview of your event.</p>
            <p className="mt-1 text-sm text-fg-muted">This event will auto start when it's time.</p>
          </div>
          {error && <p className="mt-3 text-center text-sm text-danger">{error}</p>}
        </>
      )}

      {cropping && <ImageCropDialog file={cropping} aspect={COVER_ASPECT} outputWidth={1000} onApply={(f) => void applyCover(f)} onCancel={() => setCropping(null)} />}
    </Modal>
  );
}

const inputCls = 'h-11 w-full rounded-lg bg-void px-3 text-[15px] text-fg outline-none ring-1 ring-line placeholder:text-fg-subtle focus:ring-brand-sky';

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-fg">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      {children}
    </label>
  );
}

/** The native date picker behind a Discord-style field ("Oct 24, 2026" with a calendar icon). */
function DateInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const shown = value ? new Date(`${value}T00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Pick a date';
  return (
    <span className="relative flex h-11 items-center rounded-lg bg-void px-3 ring-1 ring-line focus-within:ring-brand-sky">
      <span className="flex-1 text-[15px] text-fg">{shown}</span>
      <CalendarDays className="h-5 w-5 text-fg-muted" />
      <input
        type="date"
        value={value}
        min={dateValue(new Date())}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        onClick={(e) => (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.()}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </span>
  );
}

function LocationOption({ checked, onSelect, icon, title, hint, disabled }: { checked?: boolean; onSelect?: () => void; icon: React.ReactNode; title: string; hint: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={!!checked}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={onSelect}
      className={clsx('flex w-full items-start gap-3 text-left', disabled && 'cursor-not-allowed opacity-45')}
    >
      <span className={clsx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-2', checked ? 'bg-brand ring-brand' : 'ring-fg-subtle')}>
        {checked && <span className="h-2.5 w-2.5 rounded-full bg-white" />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-[17px] font-medium text-fg [&>svg]:h-5 [&>svg]:w-5 [&>svg]:text-fg-muted">
          {icon} {title}
        </span>
        <span className="block text-sm text-fg-muted">{hint}</span>
      </span>
    </button>
  );
}
