import { useEffect, useMemo, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button, Modal } from '@subspace/ui';
import { useStore } from '../../data/store';
import { useUi } from '../../app/ui';
import { isTrustedLink, openLeavingDialog } from '../../lib/links';
import { AppIcon, SCOPE_TEXT } from '../settings/user/AppsTabs';
import {
  askActivityAuthorization,
  authorizeActivity,
  broadcastActivityMessage,
  hasActivityConsent,
  leaveActivity,
  onActivityMessage,
  rememberActivityConsent,
  useActivityPrompt,
  useActivities,
  type Activity,
  type ActivityApp,
  type ActivityPerson,
} from './activities';

/*
 * Custom Activities in the client: a developer's page in a sandboxed iframe, and the
 * postMessage bridge @subspace/activity-sdk talks to (packages/activity-sdk/src/index.ts has the
 * other end; apps/docs/developers/activities.md the whole security model).
 *
 * sandbox: scripts, forms and popups, and allow-same-origin. That last one is safe ONLY because
 * the page is never on our origin or our site (the API refuses such URLs and so does
 * frameSrcFor below): it lets the frame keep its own origin, so its storage and its backend work
 * and so we can check event.origin against it. On our own origin it could reach into this page
 * and remove its own sandbox. Not given: top navigation (it cannot move this tab), modals,
 * downloads, pointer lock, and no powerful features (`allow` grants autoplay and fullscreen
 * only; our Permissions-Policy header keeps camera, microphone and screen capture to ourselves).
 */
export const ACTIVITY_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox';
export const ACTIVITY_ALLOW = "autoplay; fullscreen; camera 'none'; microphone 'none'; display-capture 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'; serial 'none'; hid 'none'";

const PROTOCOL = 1;
const MAX_COMMAND_BYTES = 16 * 1024;
const MAX_BROADCAST_BYTES = 4096;
/** Commands a frame may send a second (beyond that it is told RATE_LIMITED). */
const COMMANDS_PER_SECOND = 20;
const COMMANDS = new Set(['HANDSHAKE', 'AUTHORIZE', 'OPEN_EXTERNAL_LINK', 'BROADCAST']);
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

const siteOf = (host: string) => {
  const labels = host.split('.');
  return labels.length >= 3 && !/^\d+$/.test(labels[labels.length - 1]) ? labels.slice(1).join('.') : host;
};

/**
 * The iframe's src for an Activity URL from our API, or null to refuse it: it must be https (http
 * only to this machine when we are on it too), and never on our own origin or site.
 */
export function frameSrcFor(raw: string | undefined, frameId: string, instanceId: string): { src: string; origin: string } | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const here = window.location;
  const devLoopback = url.protocol === 'http:' && LOOPBACK.includes(url.hostname) && LOOPBACK.includes(here.hostname);
  if (url.protocol !== 'https:' && !devLoopback) return null;
  if (url.username || url.password) return null;
  if (url.origin === here.origin || url.hostname === here.hostname) return null;
  if (!LOOPBACK.includes(here.hostname)) {
    const site = siteOf(here.hostname);
    if (url.hostname === site || url.hostname.endsWith(`.${site}`)) return null;
  }
  url.hash = new URLSearchParams({ frame_id: frameId, parent_origin: here.origin, instance_id: instanceId }).toString();
  return { src: url.toString(), origin: url.origin };
}

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const absolute = (u: string | null) => (u ? new URL(u, window.location.origin).href : null);
const profile = (p: ActivityPerson) => ({ id: p.id, username: p.username, displayName: p.displayName, avatarUrl: absolute(p.avatarUrl) });

/** The custom Activity I am in: its privacy notice if I have not agreed yet, then its frame. */
export function CustomActivity({ activity }: { activity: Activity }) {
  const meId = useStore((s) => s.me?.id ?? '');
  const app = activity.app!;
  const [agreed, setAgreed] = useState(() => !!meId && hasActivityConsent(meId, app));
  if (!agreed) {
    // Normally agreed to before joining; this is the backstop (cleared storage, another tab...).
    return (
      <div className="p-6">
        <ActivityNotice app={app} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="link" className="text-fg" onClick={() => void leaveActivity()}>
            Leave Activity
          </Button>
          <Button
            onClick={() => {
              rememberActivityConsent(meId, app);
              setAgreed(true);
            }}
          >
            Continue
          </Button>
        </div>
      </div>
    );
  }
  return <ActivityFrame key={`${activity.id}:${app.url}`} activity={activity} />;
}

function ActivityFrame({ activity }: { activity: Activity }) {
  const app = activity.app!;
  const frameId = useMemo(randomId, []);
  const target = useMemo(() => frameSrcFor(app.url, frameId, activity.id), [app.url, frameId, activity.id]);
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<'loading' | 'connected'>('loading');
  const [ignored, setIgnored] = useState(0);
  const connected = useRef(false);
  const sent = useRef<number[]>([]);
  const busy = useRef({ authorize: false });

  /** To the frame, at its registered origin only: if it navigated elsewhere, nothing is delivered. */
  const post = (msg: Record<string, unknown>) => {
    if (target) frame.current?.contentWindow?.postMessage({ subspace: 'host', v: PROTOCOL, frameId, ...msg }, target.origin);
  };

  useEffect(() => {
    if (!target) return;
    const reply = (nonce: string, data: unknown) => post({ nonce, ok: true, data });
    const refuse = (nonce: string, code: string, message: string) => post({ nonce, ok: false, error: { code, message } });

    const people = () => (useActivities.getState().mine?.people ?? []).map(profile);
    const handle = async (nonce: string, cmd: string, args: any) => {
      const mine = useActivities.getState().mine;
      if (!mine || mine.id !== activity.id) return refuse(nonce, 'NOT_IN_ACTIVITY', 'The activity has ended');
      switch (cmd) {
        case 'HANDSHAKE': {
          if (args?.clientId !== app.id) return refuse(nonce, 'CLIENT_ID_MISMATCH', 'clientId is not the application this activity belongs to');
          connected.current = true;
          setState('connected');
          const everyone = people();
          const meId = useStore.getState().me?.id;
          const me = useStore.getState().me;
          return reply(nonce, {
            instance: { id: mine.id, channelId: mine.relayId, beaconId: mine.beaconId ?? '', hostId: mine.hostId },
            application: { id: app.id, name: app.name },
            user: everyone.find((p) => p.id === meId) ?? (me ? profile(me) : null),
            participants: everyone,
          });
        }
        case 'AUTHORIZE': {
          const scopes = args?.scopes;
          if (!Array.isArray(scopes) || !scopes.length || scopes.length > 10 || !scopes.every((s) => typeof s === 'string' && s in SCOPE_TEXT)) {
            return refuse(nonce, 'INVALID_SCOPE', `scopes must be some of ${Object.keys(SCOPE_TEXT).join(', ')}`);
          }
          if (busy.current.authorize) return refuse(nonce, 'BUSY', 'An authorization is already waiting for the person');
          busy.current.authorize = true;
          try {
            let res;
            try {
              res = await authorizeActivity(scopes, false);
            } catch (err) {
              if ((err as { code?: string }).code !== 'CONSENT_REQUIRED') throw err;
              if (!(await askActivityAuthorization(app, scopes))) return refuse(nonce, 'USER_CANCELLED', 'They did not authorize it');
              res = await authorizeActivity(scopes, true);
            }
            return reply(nonce, { code: res.code, scopes: res.scopes });
          } catch (err) {
            return refuse(nonce, (err as { code?: string }).code ?? 'ERROR', (err as Error).message);
          } finally {
            busy.current.authorize = false;
          }
        }
        case 'OPEN_EXTERNAL_LINK': {
          let href: string;
          try {
            const url = new URL(String(args?.url ?? ''));
            if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
            href = url.toString();
          } catch {
            return refuse(nonce, 'INVALID_URL', 'Only http and https links open');
          }
          if (useUi.getState().dialog) return refuse(nonce, 'BUSY', 'Another dialog is open');
          if (isTrustedLink(href)) window.open(href, '_blank', 'noopener,noreferrer');
          else openLeavingDialog(href);
          return reply(nonce, { opened: true });
        }
        case 'BROADCAST': {
          const json = JSON.stringify(args?.payload ?? null);
          if (new Blob([json]).size > MAX_BROADCAST_BYTES) return refuse(nonce, 'TOO_LARGE', `Broadcasts are at most ${MAX_BROADCAST_BYTES} bytes of JSON`);
          try {
            await broadcastActivityMessage(args?.payload ?? null);
            return reply(nonce, null);
          } catch (err) {
            return refuse(nonce, (err as { code?: string }).code ?? 'ERROR', (err as Error).message);
          }
        }
      }
    };

    const onMessage = (e: MessageEvent) => {
      const d = e.data as any;
      const ours = d && typeof d === 'object' && d.subspace === 'activity';
      if (!ours) return; // Not for us at all (YouTube's player API talks on this channel too).
      // Only that frame's window, from its registered origin, with the id we gave it.
      if (e.source !== frame.current?.contentWindow || e.origin !== target.origin || d.v !== PROTOCOL || d.frameId !== frameId || typeof d.nonce !== 'string' || d.nonce.length > 64) {
        setIgnored((n) => n + 1);
        return;
      }
      let size = 0;
      try {
        size = JSON.stringify(d).length;
      } catch {
        size = Infinity;
      }
      if (size > MAX_COMMAND_BYTES) return refuse(d.nonce, 'TOO_LARGE', 'That message is too large');
      const now = Date.now();
      sent.current = sent.current.filter((t) => now - t < 1000);
      if (sent.current.length >= COMMANDS_PER_SECOND) return refuse(d.nonce, 'RATE_LIMITED', 'Slow down');
      sent.current.push(now);
      if (typeof d.cmd !== 'string' || !COMMANDS.has(d.cmd)) return refuse(d.nonce, 'UNKNOWN_COMMAND', `Subspace does not know ${String(d.cmd).slice(0, 40)}`);
      if (d.cmd !== 'HANDSHAKE' && !connected.current) return refuse(d.nonce, 'NOT_READY', 'Call ready() first');
      void handle(d.nonce, d.cmd, d.args);
    };
    window.addEventListener('message', onMessage);

    // Who is in it, and what the others broadcast, once it is listening.
    const offPeople = useActivities.subscribe((s, prev) => {
      if (connected.current && s.mine?.id === activity.id && s.mine.people !== prev.mine?.people) post({ event: 'participants', data: { hostId: s.mine.hostId, participants: people() } });
    });
    const offMessages = onActivityMessage((m) => connected.current && post({ event: 'message', data: m }));
    return () => {
      window.removeEventListener('message', onMessage);
      offPeople();
      offMessages();
      connected.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, activity.id]);

  if (!target) {
    return <p className="p-6 text-sm text-danger">This activity cannot be shown: its address is not allowed.</p>;
  }
  return (
    <div data-testid="custom-activity" data-frame-state={state} data-ignored-messages={ignored} className="aspect-video w-full bg-void">
      <iframe
        ref={frame}
        title={app.name}
        src={target.src}
        sandbox={ACTIVITY_SANDBOX}
        allow={ACTIVITY_ALLOW}
        referrerPolicy="no-referrer"
        // A fresh, throwaway storage partition where the browser supports it: the frame cannot
        // recognise this person from cookies it set elsewhere.
        {...({ credentialless: '' } as Record<string, string>)}
        className="h-full w-full border-0"
      />
    </div>
  );
}

/** What a third-party activity will learn, shown before it first loads. */
function ActivityNotice({ app }: { app: ActivityApp }) {
  return (
    <div className="flex gap-4">
      <AppIcon name={app.name} iconUrl={app.iconUrl} size={48} />
      <div className="min-w-0 space-y-2 text-sm text-fg-muted">
        <p data-testid="activity-notice">
          <span className="font-semibold text-fg">{app.name}</span> by <span className="font-semibold text-fg">{app.developer}</span> will see your username, avatar and who is in this activity. It is
          run by its developer, not by this instance, and connects from your device (they can see your IP address).
        </p>
        <p className="break-all text-xs text-fg-subtle">Runs at {app.origin}</p>
        {!app.approved && (
          <p className="flex items-center gap-1.5 text-xs text-warning">
            <ShieldAlert className="h-4 w-4 shrink-0" /> Not reviewed yet: only its developers can open it.
          </p>
        )}
      </div>
    </div>
  );
}

/** The privacy notice and sdk.authorize()'s consent prompt (rendered by ModalHost). */
export function ActivityPrompts() {
  const prompt = useActivityPrompt((s) => s.prompt);
  if (!prompt) return null;
  const done = (ok: boolean) => {
    useActivityPrompt.setState({ prompt: null });
    prompt.resolve(ok);
  };
  if (prompt.kind === 'notice') {
    return (
      <Modal
        isOpen
        onClose={() => done(false)}
        title={`Open ${prompt.app.name}?`}
        maxWidth="md"
        footer={
          <>
            <Button variant="link" className="text-fg" onClick={() => done(false)}>
              Cancel
            </Button>
            <Button onClick={() => done(true)} data-autofocus>
              Continue
            </Button>
          </>
        }
      >
        <ActivityNotice app={prompt.app} />
      </Modal>
    );
  }
  return (
    <Modal
      isOpen
      onClose={() => done(false)}
      title={`Authorize ${prompt.app.name}`}
      description={`by ${prompt.app.developer}`}
      maxWidth="md"
      footer={
        <>
          <Button variant="link" className="text-fg" onClick={() => done(false)}>
            Cancel
          </Button>
          <Button onClick={() => done(true)} data-autofocus>
            Authorize
          </Button>
        </>
      }
    >
      <p className="text-sm text-fg-muted">This activity would like to:</p>
      <ul aria-label="Requested access" className="mt-2 space-y-1.5 text-sm text-fg">
        {prompt.scopes.map((s) => (
          <li key={s}>• {SCOPE_TEXT[s] ?? s}</li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-fg-subtle">You can take this back in User Settings › Authorized Apps.</p>
    </Modal>
  );
}
