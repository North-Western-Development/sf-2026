import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { clsx } from 'clsx';
import { Bell, BellRing, CalendarDays, MapPin, MoreHorizontal, Users, Volume2 } from 'lucide-react';
import { Button, Modal, Tooltip, useContextMenu } from '@subspace/ui';
import { useStore } from '../../data/store';
import { beaconPermissions, can, PERMISSIONS } from '../../data/permissions';
import { loadEvents, upsertEvent, removeEvent, useCommunity, type BeaconEvent } from '../../data/community';
import { closeModal, confirmAction, openModal, toast } from '../../app/ui';
import { http } from '../../lib/http';
import { term } from '../../lib/strings';
import { PixelStar } from '../auth/PixelStar';

const EMPTY: BeaconEvent[] = [];

/** "Sat, Oct 25 · 7:00 PM", with "Today" / "Tomorrow" when close. */
export function eventWhen(iso: string) {
  const d = new Date(iso);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  const date = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${date} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

/** Can the viewer edit, start, end or cancel this event? */
export function useCanEditEvent(beaconId: string) {
  const perms = useStore((s) => beaconPermissions(s, beaconId));
  const meId = useStore((s) => s.me?.id);
  return (e: BeaconEvent) => can(perms, PERMISSIONS.MANAGE_EVENTS) || (e.creator?.id === meId && can(perms, PERMISSIONS.CREATE_EVENTS));
}

/** Discord's Events dialog: the beacon's upcoming and live events, with Create Event. */
export function EventsModal({ beaconId }: { beaconId: string }) {
  const events = useCommunity((s) => s.events[beaconId] ?? EMPTY);
  const perms = useStore((s) => beaconPermissions(s, beaconId));
  const canCreate = can(perms, PERMISSIONS.CREATE_EVENTS) || can(perms, PERMISSIONS.MANAGE_EVENTS);

  useEffect(() => {
    void loadEvents(beaconId);
  }, [beaconId]);

  const create = () => openModal({ kind: 'createEvent', beaconId });

  return (
    <Modal
      isOpen
      onClose={closeModal}
      maxWidth="2xl"
      title={
        <span className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5" /> {events.length ? `${events.length} Event${events.length === 1 ? '' : 's'}` : 'Events'}
          {canCreate && events.length > 0 && (
            <Button size="sm" className="ml-auto mr-8" onClick={create}>
              Create Event
            </Button>
          )}
        </span>
      }
    >
      {events.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <PixelStar size={40} />
          <p className="text-lg font-semibold text-fg">There are no upcoming events.</p>
          <p className="max-w-sm text-sm text-fg-muted">Schedule an event for any planned activity in your {term('beacon').toLowerCase()}. You can give it a place, a time and a description.</p>
          {canCreate && <Button onClick={create}>Create Event</Button>}
        </div>
      ) : (
        <ul className="max-h-[60vh] space-y-3 overflow-y-auto pb-1" aria-label="Events">
          {events.map((e) => (
            <li key={e.id}>
              <EventCard event={e} />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function EventCard({ event: e, preview }: { event: BeaconEvent; preview?: boolean }) {
  const navigate = useNavigate();
  const relay = useStore((s) => (e.relayId ? s.relays[e.relayId] : undefined));
  const canEdit = useCanEditEvent(e.beaconId)(e);
  const { openContextMenu } = useContextMenu();
  const live = e.status === 'active';

  const call = async (fn: () => Promise<{ event: BeaconEvent } | void>) => {
    try {
      const res = await fn();
      if (res) upsertEvent(res.event);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const path = `/beacons/${e.beaconId}/events/${e.id}`;
  const toggleInterest = () => call(() => (e.meInterested ? http.delete<{ event: BeaconEvent }>(`${path}/interest`) : http.put<{ event: BeaconEvent }>(`${path}/interest`, {})));
  const setStatus = (status: BeaconEvent['status']) => call(() => http.patch<{ event: BeaconEvent }>(path, { status }));

  return (
    <article aria-label={e.name} className={clsx('overflow-hidden rounded-xl bg-raised ring-1', live ? 'ring-online/60' : 'ring-line')}>
      {e.coverUrl && <img src={e.coverUrl} alt="" className="h-32 w-full object-cover" />}
      <div className="p-4">
        <p className={clsx('flex items-center gap-1.5 text-xs font-semibold', live ? 'text-online' : 'text-fg-muted')}>
          {live ? (
            <>
              <span className="h-2 w-2 animate-pulse rounded-full bg-online" /> Happening now
            </>
          ) : (
            <>
              <CalendarDays className="h-3.5 w-3.5" /> {eventWhen(e.startAt)}
              {e.endAt && <span className="font-normal"> – {new Date(e.endAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>}
            </>
          )}
        </p>
        <h3 className="mt-1 text-lg font-bold leading-snug text-fg">{e.name}</h3>
        {e.description && <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-fg-muted">{e.description}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {e.locationType === 'comm_link' ? (
            <button
              type="button"
              disabled={preview || !relay}
              onClick={() => {
                closeModal();
                navigate(`/channels/${e.beaconId}/${e.relayId}`);
              }}
              className="flex min-w-0 items-center gap-1.5 text-sm text-fg-muted enabled:hover:text-fg enabled:hover:underline"
            >
              <Volume2 className="h-4 w-4 shrink-0" />
              <span className="truncate">{relay?.name ?? term('commLink')}</span>
            </button>
          ) : (
            <span className="flex min-w-0 items-center gap-1.5 text-sm text-fg-muted">
              <MapPin className="h-4 w-4 shrink-0" />
              <span className="truncate">{e.location}</span>
            </span>
          )}
          <Tooltip content={`${e.interestedCount} interested`}>
            <span className="flex items-center gap-1 text-sm text-fg-muted" aria-label={`${e.interestedCount} interested`}>
              <Users className="h-4 w-4" /> {e.interestedCount}
            </span>
          </Tooltip>
          {!preview && (
            <div className="ml-auto flex items-center gap-2">
              {canEdit && e.status === 'scheduled' && (
                <Button size="sm" variant="outline" onClick={() => void setStatus('active')}>
                  Start
                </Button>
              )}
              {canEdit && live && (
                <Button size="sm" variant="outline" onClick={() => void setStatus('completed')}>
                  End Event
                </Button>
              )}
              <Button size="sm" variant={e.meInterested ? 'secondary' : 'primary'} aria-pressed={!!e.meInterested} onClick={() => void toggleInterest()}>
                {e.meInterested ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />} Interested
              </Button>
              {canEdit && (
                <button
                  type="button"
                  aria-label="Event options"
                  onClick={(ev) =>
                    openContextMenu({ clientX: ev.clientX, clientY: ev.clientY }, [
                      { label: 'Edit Event', onClick: () => openModal({ kind: 'createEvent', beaconId: e.beaconId, eventId: e.id }) },
                      {
                        label: e.status === 'scheduled' ? 'Cancel Event' : 'Delete Event',
                        danger: true,
                        onClick: () =>
                          confirmAction({
                            title: e.status === 'scheduled' ? 'Cancel Event' : 'Delete Event',
                            body: `Are you sure you want to cancel “${e.name}”? Everyone interested loses it from their list.`,
                            confirmLabel: e.status === 'scheduled' ? 'Cancel Event' : 'Delete Event',
                            danger: true,
                            onConfirm: async () => {
                              await http.delete(path);
                              removeEvent(e.beaconId, e.id);
                            },
                          }),
                      },
                    ])
                  }
                  className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
                >
                  <MoreHorizontal className="h-5 w-5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
