import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Clapperboard, Eraser, LogOut, PenLine, Rocket } from 'lucide-react';
import { clsx } from 'clsx';
import { Button, Input } from '@subspace/ui';
import { useNavigate } from 'react-router';
import { useStore } from '../../data/store';
import { http, optional } from '../../lib/http';
import { joinVoice } from './session';
import { relayPermissions, can, PERMISSIONS } from '../../data/permissions';
import { resolveName } from '../../lib/normalize';
import { ControlButton } from './ControlButton';
import {
  ACTIVITY_INFO,
  joinActivity,
  leaveActivity,
  loadActivity,
  loadStrokes,
  onActivityEvent,
  sendActivityEvent,
  startActivity,
  useActivities,
  type ActivityKind,
  type Stroke,
  type WatchState,
} from './activities';

const ICON: Record<ActivityKind, React.ReactNode> = {
  watch: <Clapperboard className="h-5 w-5" />,
  whiteboard: <PenLine className="h-5 w-5" />,
};

/** The comm-link's activity launcher (Discord's rocket button). */
export function ActivitiesButton({ relayId }: { relayId: string }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [picking, setPicking] = useState<ActivityKind | null>(null);
  const [url, setUrl] = useState('');
  const running = useActivities((s) => s.byRelay[relayId]);
  const mine = useActivities((s) => s.mine);
  const allowed = useStore((s) => can(relayPermissions(s, relayId), PERMISSIONS.USE_ACTIVITIES));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!anchor) return;
    void loadActivity(relayId);
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setAnchor(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAnchor(null);
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc);
    };
  }, [anchor, relayId]);
  if (!allowed) return null;

  const close = () => {
    setAnchor(null);
    setPicking(null);
    setUrl('');
  };
  const start = async (kind: ActivityKind) => {
    if (kind === 'watch' && !picking) return setPicking('watch');
    if (await startActivity(relayId, kind, kind === 'watch' ? url.trim() : undefined)) close();
  };

  return (
    <>
      <ControlButton label="Start an Activity" active={!!anchor || mine?.relayId === relayId} onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}>
        <Rocket className="h-5 w-5" />
      </ControlButton>
      {anchor &&
        createPortal(
          <div
            ref={ref}
            role="dialog"
            aria-label="Activities"
            className="fixed z-[1500] w-80 rounded-xl bg-overlay p-3 shadow-pop ring-1 ring-line"
            style={{ left: Math.max(8, Math.min(window.innerWidth - 328, anchor.left + anchor.width / 2 - 160)), bottom: window.innerHeight - anchor.top + 8 }}
          >
            <p className="mb-2 text-xs font-semibold uppercase text-fg-muted">Activities</p>
            {running && mine?.relayId !== relayId ? (
              <div className="rounded-lg bg-raised p-3">
                <p className="flex items-center gap-2 font-semibold text-fg">
                  {ICON[running.kind]} {ACTIVITY_INFO[running.kind].name}
                </p>
                <p className="mt-1 text-sm text-fg-muted">{running.count} in it now</p>
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => {
                    void joinActivity(relayId);
                    close();
                  }}
                >
                  Join Activity
                </Button>
              </div>
            ) : running ? (
              <p className="text-sm text-fg-muted">You are in {ACTIVITY_INFO[running.kind].name}. Leave it to start another.</p>
            ) : picking === 'watch' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void start('watch');
                }}
                className="space-y-3"
              >
                <Input label="Video Link" placeholder="https://youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="link" className="text-fg" onClick={() => setPicking(null)}>
                    Back
                  </Button>
                  <Button size="sm" type="submit" disabled={!url.trim()}>
                    Start
                  </Button>
                </div>
              </form>
            ) : (
              <div className="space-y-1.5">
                {(Object.keys(ACTIVITY_INFO) as ActivityKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => void start(kind)}
                    className="flex w-full items-center gap-3 rounded-lg bg-raised p-3 text-left hover:bg-hover"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-sky">{ICON[kind]}</span>
                    <span>
                      <span className="block font-semibold text-fg">{ACTIVITY_INFO[kind].name}</span>
                      <span className="block text-xs text-fg-muted">{ACTIVITY_INFO[kind].blurb}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

/** "X started Whiteboard": shown to people in the comm-link who are not in the activity yet. */
export function ActivityBanner({ relayId, beaconId, joined }: { relayId: string; beaconId: string; joined: boolean }) {
  const running = useActivities((s) => s.byRelay[relayId]);
  const mine = useActivities((s) => s.mine);
  const host = useStore((s) => (running ? s.users[running.hostId] : undefined));
  const member = useStore((s) => (running ? s.members[beaconId]?.[running.hostId] : undefined));
  useEffect(() => {
    void loadActivity(relayId);
  }, [relayId]);
  if (!running || mine?.relayId === relayId) return null;
  return (
    <div role="status" className="mb-3 flex items-center gap-3 rounded-lg bg-raised px-4 py-3">
      <span className="text-brand-sky">{ICON[running.kind]}</span>
      <p className="min-w-0 flex-1 text-sm text-fg">
        <span className="font-semibold">{ACTIVITY_INFO[running.kind].name}</span>
        <span className="text-fg-muted">
          {' '}
          · {host ? `started by ${resolveName(host, member)}` : 'running'} · {running.count} in it
        </span>
      </p>
      {joined && (
        <Button size="sm" onClick={() => void joinActivity(relayId)}>
          Join Activity
        </Button>
      )}
    </div>
  );
}

/** The activity I am in, above the comm-link's tiles. */
export function ActivityStage({ relayId }: { relayId: string }) {
  const mine = useActivities((s) => (s.mine?.relayId === relayId ? s.mine : null));
  if (!mine) return null;
  return (
    <section aria-label={ACTIVITY_INFO[mine.kind].name} className="mb-4 overflow-hidden rounded-xl bg-raised ring-1 ring-line">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-brand-sky">{ICON[mine.kind]}</span>
        <span className="font-semibold text-fg">{ACTIVITY_INFO[mine.kind].name}</span>
        <span className="text-sm text-fg-muted">· {mine.count} in it</span>
        <button type="button" onClick={() => void leaveActivity()} className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-fg-muted hover:bg-hover hover:text-danger">
          <LogOut className="h-4 w-4" /> Leave Activity
        </button>
      </header>
      {mine.kind === 'whiteboard' ? <Whiteboard relayId={relayId} /> : <WatchTogether />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Whiteboard
// ---------------------------------------------------------------------------

const PENS = ['#EEF1FA', '#3DCBFF', '#3B8EF2', '#FFF36B', '#FF5C7A', '#5EE6A0'];

function Whiteboard({ relayId }: { relayId: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const drawing = useRef<number[] | null>(null);
  const [color, setColor] = useState(PENS[1]);
  const [count, setCount] = useState(0);
  const meId = useStore((s) => s.me?.id ?? '');

  const paint = () => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    const line = (pts: number[], c: string, w: number) => {
      ctx.strokeStyle = c;
      ctx.lineWidth = w * (el.width / 800);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) {
        const x = pts[i] * el.width;
        const y = pts[i + 1] * el.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    strokes.current.forEach((s) => line(s.points, s.color, s.width));
    if (drawing.current) line(drawing.current, color, 3);
  };

  useEffect(() => {
    let live = true;
    void loadStrokes(relayId).then((list) => {
      if (!live) return;
      strokes.current = list;
      setCount(list.length);
      paint();
    });
    const off = onActivityEvent((type, data) => {
      if (type === 'stroke') {
        if (strokes.current.some((s) => s.id === data.id)) return;
        strokes.current.push(data);
      } else if (type === 'clear') strokes.current = [];
      else return;
      setCount(strokes.current.length);
      paint();
    });
    return () => {
      live = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayId]);

  const at = (e: ReactPointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = at(e);
  };
  const move = (e: ReactPointerEvent) => {
    if (!drawing.current) return;
    drawing.current.push(...at(e));
    paint();
  };
  const up = () => {
    const pts = drawing.current;
    drawing.current = null;
    if (!pts || pts.length < 4) return paint();
    // At most 250 points a stroke: keep every nth.
    const step = Math.ceil(pts.length / 2 / 250);
    const kept = step > 1 ? pts.filter((_, i) => Math.floor(i / 2) % step === 0) : pts;
    const stroke: Stroke = { id: `${meId}-${Date.now()}`, points: kept.map((n) => Math.round(n * 10000) / 10000), color, width: 3, by: meId };
    strokes.current.push(stroke);
    setCount(strokes.current.length);
    paint();
    void sendActivityEvent('stroke', { id: stroke.id, points: stroke.points, color, width: 3 });
  };

  return (
    <div>
      <canvas
        ref={canvas}
        width={1600}
        height={900}
        aria-label="Whiteboard canvas"
        data-strokes={count}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className="block aspect-video w-full touch-none cursor-crosshair bg-void"
      />
      <div className="flex items-center gap-2 px-3 py-2">
        {PENS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Pen ${c}`}
            aria-pressed={color === c}
            onClick={() => setColor(c)}
            className={clsx('h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-raised', color === c ? 'ring-fg' : 'ring-transparent')}
            style={{ backgroundColor: c }}
          />
        ))}
        <button
          type="button"
          onClick={() => {
            strokes.current = [];
            setCount(0);
            paint();
            void sendActivityEvent('clear');
          }}
          className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Eraser className="h-4 w-4" /> Clear
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Watch Together
// ---------------------------------------------------------------------------

const youtubeId = (url: string) => /(?:v=|youtu\.be\/|embed\/)([\w-]{6,})/.exec(url)?.[1] ?? null;
/** Where the shared video should be now. */
const positionNow = (w: WatchState) => w.position + (w.playing ? (Date.now() - w.at) / 1000 : 0);

interface Player {
  play(): void;
  pause(): void;
  seek(s: number): void;
  time(): number;
}

let ytReady: Promise<any> | null = null;
function loadYouTube(): Promise<any> {
  ytReady ??= new Promise((resolve) => {
    const w = window as any;
    if (w.YT?.Player) return resolve(w.YT);
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(w.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    document.head.appendChild(s);
  });
  return ytReady;
}

function WatchTogether() {
  const watch = useActivities((s) => s.mine?.watch);
  const meId = useStore((s) => s.me?.id);
  const host = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const player = useRef<Player | null>(null);
  /** Applying someone else's change: do not echo it back. */
  const applying = useRef(0);
  const url = watch?.url ?? '';
  const ytId = youtubeId(url);

  const share = (playing: boolean) => {
    if (Date.now() < applying.current || !player.current) return;
    void sendActivityEvent('watch', { url, playing, position: player.current.time() });
  };

  // Build the player for this video.
  useEffect(() => {
    if (!url) return;
    if (ytId && host.current) {
      let yt: any;
      void loadYouTube().then((YT) => {
        if (!host.current) return;
        yt = new YT.Player(host.current, {
          videoId: ytId,
          playerVars: { playsinline: 1, rel: 0 },
          events: {
            onReady: () => {
              player.current = { play: () => yt.playVideo(), pause: () => yt.pauseVideo(), seek: (s) => yt.seekTo(s, true), time: () => yt.getCurrentTime() };
              const w = useActivities.getState().mine?.watch;
              if (w) apply(w);
            },
            onStateChange: (e: { data: number }) => {
              if (e.data === 1) share(true);
              else if (e.data === 2) share(false);
            },
          },
        });
      });
      return () => {
        yt?.destroy?.();
        player.current = null;
      };
    }
    const el = video.current;
    if (!el) return;
    player.current = { play: () => void el.play().catch(() => {}), pause: () => el.pause(), seek: (s) => (el.currentTime = s), time: () => el.currentTime };
    const w = useActivities.getState().mine?.watch;
    if (w) apply(w);
    return () => {
      player.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ytId]);

  const apply = (w: WatchState) => {
    const p = player.current;
    if (!p) return;
    applying.current = Date.now() + 800;
    const target = positionNow(w);
    if (Math.abs(p.time() - target) > 1.5) p.seek(target);
    if (w.playing) p.play();
    else p.pause();
  };

  // Someone else played, paused or seeked.
  useEffect(() => {
    if (watch && watch.by && watch.by !== meId) apply(watch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch?.at]);

  if (!watch) return null;
  return (
    <div data-watch-url={url} data-playing={watch.playing ? 'true' : 'false'}>
      {ytId ? (
        <div className="aspect-video w-full bg-void">
          <div ref={host} className="h-full w-full" />
        </div>
      ) : (
        <video
          ref={video}
          src={url}
          controls
          playsInline
          aria-label="Shared video"
          className="block aspect-video w-full bg-void"
          onPlay={() => share(true)}
          onPause={() => share(false)}
          onSeeked={() => share(!video.current?.paused)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// On profiles (Privacy Settings › Share my activity / Activity joining)
// ---------------------------------------------------------------------------

interface SharedActivity {
  kind: ActivityKind;
  relayId: string;
  relayName: string;
  startedAt: string;
  joinable: boolean;
}

/** "In an activity": what a member is doing in this beacon, with Join when they allow it. */
export function ProfileActivity({ userId, beaconId, onJoined }: { userId: string; beaconId?: string; onJoined?: () => void }) {
  const [activity, setActivity] = useState<SharedActivity | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    if (!beaconId) return;
    void optional(http.get<{ activity: SharedActivity | null }>(`/users/${userId}/activity?beaconId=${beaconId}`), { activity: null }).then((r) => setActivity(r.activity));
  }, [userId, beaconId]);
  if (!activity || !beaconId) return null;
  const join = async () => {
    setBusy(true);
    navigate(`/channels/${beaconId}/${activity.relayId}`);
    await joinVoice(activity.relayId, beaconId);
    await joinActivity(activity.relayId);
    setBusy(false);
    onJoined?.();
  };
  return (
    <div data-testid="profile-activity">
      <p className="mb-1 text-xs font-semibold text-fg-muted">In an Activity</p>
      <div className="flex items-center gap-3 rounded-md bg-raised p-2">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-sky">{ICON[activity.kind]}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-fg">{ACTIVITY_INFO[activity.kind].name}</span>
          <span className="block truncate text-xs text-fg-muted">in {activity.relayName}</span>
        </span>
        {activity.joinable && (
          <Button size="sm" isLoading={busy} onClick={() => void join()}>
            Join
          </Button>
        )}
      </div>
    </div>
  );
}
