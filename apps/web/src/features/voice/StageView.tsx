import { useEffect } from 'react';
import { clsx } from 'clsx';
import { Hand, Mic, MicOff, PhoneOff, Podcast, Radio, UserMinus, UserPlus } from 'lucide-react';
import { Button } from '@subspace/ui';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../data/store';
import { relayPermissions, can, PERMISSIONS } from '../../data/permissions';
import { resolveName } from '../../lib/normalize';
import type { Relay } from '../../lib/types';
import { promptText, confirmAction } from '../../app/ui';
import { MobileNavButton } from '../../app/mobile';
import { useVoice, joinVoice, leaveVoice } from './session';
import { useAudioPrefs, toggleMute } from './audioPrefs';
import { Avatar } from '../common/Avatar';
import { ControlButton } from './ControlButton';
import { Tile } from './CommLinkView';
import { EMPTY_STAGE, answerInvite, endStage, inviteToSpeak, loadStage, moveToAudience, raiseHand, setStageTopic, startStage, useStages } from './stage';

function AudienceMember({ userId, relay, hand, invited, moderator }: { userId: string; relay: Relay; hand: boolean; invited: boolean; moderator: boolean }) {
  const user = useStore((s) => s.users[userId]);
  const member = useStore((s) => s.members[relay.beaconId]?.[userId]);
  const vs = useStore((s) => s.voice[userId]);
  const name = user ? resolveName(user, member) : vs?.username ?? 'Transmitter';
  return (
    <li aria-label={name} className="flex w-24 flex-col items-center gap-1 text-center">
      <span className="relative">
        <Avatar user={user ?? { id: userId, username: name, displayName: name, avatarUrl: null }} size={56} />
        {hand && (
          <span aria-label="Requested to speak" className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-star text-on-star">
            <Hand className="h-3.5 w-3.5" />
          </span>
        )}
      </span>
      <span className="w-full truncate text-xs text-fg-muted">{name}</span>
      {moderator && invited && <span className="text-xs text-fg-subtle">Invited</span>}
      {moderator && !invited && (
        <button
          type="button"
          aria-label={`Invite ${name} to speak`}
          onClick={() => void inviteToSpeak(relay.id, userId)}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-brand-sky hover:bg-hover"
        >
          <UserPlus className="h-3 w-3" /> Invite
        </button>
      )}
    </li>
  );
}

/** Discord's Stage: speakers talk, the audience listens and can ask to speak. */
export function StageView({ relay }: { relay: Relay }) {
  const inRoom = useStore(useShallow((s) => Object.values(s.voice).filter((v) => v.relayId === relay.id).map((v) => v.transmitterId)));
  const session = useVoice(useShallow((s) => ({ relayId: s.relayId, state: s.state })));
  const stage = useStages((s) => s.byRelay[relay.id] ?? EMPTY_STAGE);
  const moderator = useStages((s) => !!s.moderator[relay.id]);
  const meId = useStore((s) => s.me?.id ?? '');
  const canConnect = useStore((s) => can(relayPermissions(s, relay.id), PERMISSIONS.CONNECT_AUDIO));
  const canRequest = useStore((s) => can(relayPermissions(s, relay.id), PERMISSIONS.REQUEST_TO_SPEAK));
  const { muted } = useAudioPrefs();
  // Joined once the gateway has us in the room: only then can the API see us on the Stage.
  const joined = session.relayId === relay.id && session.state === 'connected' && inRoom.includes(meId);
  const live = !!stage.startedAt;
  const speakers = stage.speakers.filter((id) => inRoom.includes(id));
  const audience = inRoom.filter((id) => !speakers.includes(id));
  const iSpeak = speakers.includes(meId);
  const handUp = stage.requests.includes(meId);
  const invited = live && joined && stage.invites.includes(meId);

  useEffect(() => {
    void loadStage(relay.id);
  }, [relay.id]);

  const askTopic = (initial = '', then: (t: string) => Promise<void>) =>
    promptText({ title: initial ? 'Edit Topic' : 'Start Stage', label: 'Topic', initial, maxLength: 120, confirmLabel: initial ? 'Save' : 'Start Stage', onSubmit: then });

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-void">
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        <MobileNavButton />
        <Podcast className="h-6 w-6 text-fg-subtle" />
        <h1 className="font-semibold text-fg">{relay.name}</h1>
        {live && (
          <span className="flex items-center gap-1 rounded-full bg-online/15 px-2 py-0.5 text-xs font-bold uppercase text-online">
            <Radio className="h-3 w-3" /> Live
          </span>
        )}
        {moderator && live && (
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => askTopic(stage.topic ?? '', (t) => setStageTopic(relay.id, t))}>
              Edit Topic
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                confirmAction({ title: 'End Stage', body: 'Everyone stays connected but goes back to the audience.', confirmLabel: 'End Stage', danger: true, onConfirm: () => endStage(relay.id) })
              }
            >
              End Stage
            </Button>
          </div>
        )}
      </header>

      <section className="min-h-0 flex-1 overflow-y-auto p-6">
        {live ? (
          <h2 data-testid="stage-topic" className="mb-6 text-2xl font-bold text-fg">
            {stage.topic}
          </h2>
        ) : (
          <div className="mb-8 flex flex-col items-center gap-3 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-raised">
              <Podcast className="h-10 w-10 text-fg-muted" />
            </span>
            <h2 className="text-2xl font-bold text-fg">{relay.name}</h2>
            <p className="max-w-md text-fg-muted">
              {moderator ? 'Start the Stage with a topic. You speak first; invite others up when they ask.' : 'This Stage is not live. You can wait here for it to start.'}
            </p>
            {moderator && (
              <Button onClick={() => askTopic('', (t) => startStage(relay.id, t))} disabled={!joined}>
                {joined ? 'Start Stage' : 'Join to start the Stage'}
              </Button>
            )}
          </div>
        )}

        {live && (
          <>
            <p className="mb-2 text-xs font-semibold uppercase text-fg-muted">Speakers — {speakers.length}</p>
            <div aria-label="Speakers" role="list" className="mb-8 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
              {speakers.map((id) => (
                <div key={id} role="listitem" className="relative">
                  <Tile userId={id} beaconId={relay.beaconId} />
                  {moderator && id !== meId && (
                    <button
                      type="button"
                      aria-label="Move to audience"
                      onClick={() => void moveToAudience(relay.id, id)}
                      className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-void/75 text-fg-muted hover:text-danger"
                    >
                      <UserMinus className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              {!speakers.length && <p className="text-sm text-fg-subtle">Nobody is speaking yet.</p>}
            </div>
            {moderator && stage.requests.length > 0 && <p className="mb-2 text-xs font-semibold uppercase text-star">Requests to speak — {stage.requests.length}</p>}
          </>
        )}

        <p className="mb-3 text-xs font-semibold uppercase text-fg-muted">{live ? 'In the audience' : 'Waiting'} — {audience.length}</p>
        <ul aria-label="Audience" className="flex flex-wrap gap-3">
          {audience
            .slice()
            .sort((a, b) => Number(stage.requests.includes(b)) - Number(stage.requests.includes(a)))
            .map((id) => (
              <AudienceMember key={id} userId={id} relay={relay} hand={stage.requests.includes(id)} invited={stage.invites.includes(id)} moderator={moderator && live} />
            ))}
        </ul>
      </section>

      {invited && (
        <div role="alertdialog" aria-label="Invited to speak" className="mx-auto mb-3 flex w-full max-w-md items-center gap-3 rounded-lg bg-raised px-4 py-3 ring-1 ring-line">
          <UserPlus className="h-5 w-5 shrink-0 text-brand-sky" />
          <p className="min-w-0 flex-1 text-sm text-fg">You have been invited to speak.</p>
          <Button size="sm" variant="secondary" onClick={() => void answerInvite(relay.id, false)}>
            Decline
          </Button>
          <Button size="sm" onClick={() => void answerInvite(relay.id, true)}>
            Join as Speaker
          </Button>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-center gap-3 pb-6 pt-2">
        {joined ? (
          <>
            {iSpeak && (
              <ControlButton label={muted ? 'Unmute' : 'Mute'} active={muted} onClick={toggleMute}>
                {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </ControlButton>
            )}
            {live && iSpeak && (
              <Button variant="secondary" onClick={() => void moveToAudience(relay.id, meId)}>
                Move to Audience
              </Button>
            )}
            {live && !iSpeak && moderator && <Button onClick={() => void inviteToSpeak(relay.id, meId)}>Speak</Button>}
            {live && !iSpeak && !moderator && (canRequest || handUp) && (
              <ControlButton label={handUp ? 'Lower Hand' : 'Request to Speak'} active={handUp} onClick={() => void raiseHand(relay.id, !handUp)}>
                <Hand className="h-5 w-5" />
              </ControlButton>
            )}
            <ControlButton label="Leave Stage" danger onClick={() => void leaveVoice()}>
              <PhoneOff className="h-5 w-5" />
            </ControlButton>
          </>
        ) : (
          <button
            type="button"
            disabled={!canConnect || session.state === 'connecting'}
            onClick={() => void joinVoice(relay.id, relay.beaconId)}
            className={clsx('rounded-full bg-online px-6 py-2.5 font-semibold text-void hover:brightness-110 disabled:opacity-50')}
          >
            {!canConnect ? 'You cannot join this Stage' : session.relayId === relay.id && session.state === 'connecting' ? 'Connecting…' : 'Join Stage'}
          </button>
        )}
      </div>
    </div>
  );
}
