import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { ArrowLeft, Lock } from 'lucide-react';
import { Modal, Tooltip } from '@subspace/ui';
import { useStore } from '../../data/store';
import { closeModal, toast } from '../../app/ui';
import { http } from '../../lib/http';
import { Switch } from '../settings/SettingsLayout';

type Criteria = 'staff' | 'early_account' | 'account_age' | 'transmissions_sent' | 'voice_minutes';
type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

interface Tier {
  code: string;
  name: string;
  description: string;
  threshold: number;
  tier: number;
  rarity: Rarity;
  iconUrl: string;
}
interface Family {
  family: string;
  name: string;
  unlockable: boolean;
  criteriaType: Criteria;
  hint?: string;
  tiers: Tier[];
}
interface Owned {
  commendationId: string;
  code: string;
  isVisible: boolean;
  awardedAt: string;
}
type Progress = Record<'voice_minutes' | 'transmissions_sent' | 'account_age', number>;

const RARITY_STYLE: Record<Rarity, string> = {
  common: 'text-fg-muted ring-fg-muted/50',
  uncommon: 'text-online ring-online/50',
  rare: 'text-brand-sky ring-brand-sky/50',
  epic: 'text-[#b69bff] ring-[#b69bff]/50',
  legendary: 'text-star ring-star/50',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "5 hours", "100 transmissions", "2 years": a level's requirement. */
function requirement(c: Criteria, threshold: number) {
  if (c === 'voice_minutes') return plural(threshold / 60, 'hour');
  if (c === 'transmissions_sent') return plural(threshold, 'transmission');
  if (c === 'account_age') return plural(Math.round(threshold / 365), 'year');
  return '';
}
/** What you have so far, in the header line. */
function soFar(c: Criteria, p: Progress) {
  if (c === 'voice_minutes') return `${plural(Math.floor(p.voice_minutes / 60), 'hour')} in Comm-Links`;
  if (c === 'transmissions_sent') return `${plural(p.transmissions_sent, 'transmission')} sent`;
  if (c === 'account_age') return `${plural(p.account_age, 'day')} on Subspace`;
  return null;
}
function amount(c: Criteria, p: Progress) {
  if (c === 'voice_minutes') return p.voice_minutes;
  if (c === 'transmissions_sent') return p.transmissions_sent;
  if (c === 'account_age') return p.account_age;
  return 0;
}
/** "827 more hours" to the next level. */
function remaining(c: Criteria, left: number) {
  if (c === 'voice_minutes') return `${plural(Math.ceil(left / 60), 'more hour', 'more hours')}`;
  if (c === 'transmissions_sent') return `${plural(left, 'more transmission', 'more transmissions')}`;
  return `${plural(left, 'more day', 'more days')}`;
}
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' });

/**
 * Discord's badge browser: your badges and the ones you can still unlock on the left, the
 * selected badge's progress and level ladder on the right. Granted badges (staff, early
 * accounts) show only when you have them.
 */
export function BadgesModal() {
  const meId = useStore((s) => s.me?.id);
  const [families, setFamilies] = useState<Family[] | null>(null);
  const [progress, setProgress] = useState<Progress>({ voice_minutes: 0, transmissions_sent: 0, account_age: 0 });
  const [owned, setOwned] = useState<Record<string, Owned>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!meId) return;
    Promise.all([
      http.get<{ families: Family[]; progress: Progress }>('/transmitters/commendations'),
      http.get<{ deck: Owned[] }>(`/transmitters/${meId}/commendations`),
    ])
      .then(([c, d]) => {
        setFamilies(c.families);
        setProgress(c.progress);
        setOwned(Object.fromEntries(d.deck.map((b) => [b.code, b])));
      })
      .catch((e) => setError((e as Error).message));
  }, [meId]);

  const { yours, available } = useMemo(() => {
    const list = families ?? [];
    return {
      yours: list.filter((f) => f.tiers.some((t) => owned[t.code])),
      available: list.filter((f) => f.unlockable && !f.tiers.some((t) => owned[t.code])),
    };
  }, [families, owned]);
  const current = [...yours, ...available].find((f) => f.family === selected) ?? yours[0] ?? available[0];

  const setFamilyVisible = async (f: Family, isVisible: boolean) => {
    const rows = f.tiers.map((t) => owned[t.code]).filter(Boolean);
    const before = owned;
    setOwned((o) => ({ ...o, ...Object.fromEntries(rows.map((r) => [r.code, { ...r, isVisible }])) }));
    try {
      await http.patch('/transmitters/me/commendations', { updates: rows.map((r) => ({ commendationId: r.commendationId, isVisible })) });
    } catch (e) {
      setOwned(before);
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Modal isOpen onClose={closeModal} ariaLabel="Badges" maxWidth="4xl" className="!max-w-[760px]">
      <div className="-mx-6 -my-4 flex min-h-[520px] flex-col md:flex-row">
        <aside className="flex w-full shrink-0 flex-col border-line bg-raised md:w-[290px] md:border-r">
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <h2 className="text-xl font-semibold text-fg">Your badges</h2>
            <p className="mt-1 text-sm text-fg-muted">Browse your badges and discover new ones you can unlock.</p>
            {error && <p className="mt-4 text-sm text-danger">{error}</p>}
            {!families && !error && <p className="mt-4 text-sm text-fg-muted">Loading…</p>}
            {families && (
              <>
                {yours.length === 0 && <p className="mt-4 text-sm text-fg-subtle">None yet. Keep transmitting.</p>}
                <BadgeGrid label="Your badges" families={yours} owned={owned} selected={!customizing ? current?.family : undefined} onSelect={(f) => (setSelected(f), setCustomizing(false))} />
                {available.length > 0 && (
                  <>
                    <h3 className="mb-2 mt-6 text-sm font-semibold text-fg">Available to unlock</h3>
                    <BadgeGrid label="Available to unlock" families={available} owned={owned} selected={!customizing ? current?.family : undefined} onSelect={(f) => (setSelected(f), setCustomizing(false))} />
                  </>
                )}
              </>
            )}
          </div>
          <div className="border-t border-line p-4">
            <button
              type="button"
              disabled={!yours.length}
              onClick={() => setCustomizing((v) => !v)}
              className="h-10 w-full rounded-md bg-overlay text-sm font-semibold text-fg ring-1 ring-line hover:bg-hover disabled:opacity-50"
            >
              {customizing ? 'Done Customizing' : 'Customize Your Badges'}
            </button>
          </div>
        </aside>

        <section className="min-w-0 flex-1 p-6 pr-14">
          {customizing ? (
            <Customize families={yours} owned={owned} onBack={() => setCustomizing(false)} onToggle={(f, v) => void setFamilyVisible(f, v)} />
          ) : current ? (
            <Detail family={current} owned={owned} progress={progress} />
          ) : null}
        </section>
      </div>
    </Modal>
  );
}

/** The highest level you hold, or the first level when you hold none. */
const shownTier = (f: Family, owned: Record<string, Owned>) => [...f.tiers].reverse().find((t) => owned[t.code]) ?? f.tiers[0];

function BadgeGrid({ label, families, owned, selected, onSelect }: { label: string; families: Family[]; owned: Record<string, Owned>; selected?: string; onSelect: (family: string) => void }) {
  return (
    <div role="list" aria-label={label} className="mt-4 grid grid-cols-4 gap-3">
      {families.map((f) => {
        const t = shownTier(f, owned);
        return (
          <Tooltip key={f.family} content={t.name}>
            <button
              type="button"
              role="listitem"
              aria-label={t.name}
              aria-pressed={selected === f.family}
              onClick={() => onSelect(f.family)}
              className={clsx(
                'flex aspect-square items-center justify-center rounded-lg bg-overlay ring-1 transition-colors hover:bg-hover',
                selected === f.family ? 'ring-brand-sky' : 'ring-line'
              )}
            >
              <img src={t.iconUrl} alt="" className="h-8 w-8 [image-rendering:pixelated]" />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

function Detail({ family: f, owned, progress }: { family: Family; owned: Record<string, Owned>; progress: Progress }) {
  const held = [...f.tiers].reverse().find((t) => owned[t.code]);
  const top = held ?? f.tiers[0];
  const have = amount(f.criteriaType, progress);
  const next = f.unlockable ? f.tiers.find((t) => !owned[t.code] && t.threshold > have) ?? f.tiers.find((t) => !owned[t.code]) : undefined;
  const base = held?.threshold ?? 0;
  const pct = next ? Math.max(0, Math.min(100, ((have - base) / Math.max(1, next.threshold - base)) * 100)) : 100;
  const line = f.unlockable ? soFar(f.criteriaType, progress) : top.description;

  return (
    <div aria-label={`${top.name} details`}>
      <div className="flex items-center gap-4">
        <img src={top.iconUrl} alt="" className={clsx('h-14 w-14 [image-rendering:pixelated]', !held && 'opacity-50 grayscale')} />
        <div className="min-w-0">
          <h3 className="text-2xl font-extrabold uppercase tracking-wide text-fg">{top.name}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
            {line && <span>{line}</span>}
            {held ? <span>• Unlocked {fmtDate(owned[held.code].awardedAt)}</span> : <span>• Locked</span>}
            <span>•</span>
            <span className={clsx('rounded-full px-1.5 text-[10px] font-bold uppercase leading-4 ring-1', RARITY_STYLE[top.rarity])}>{top.rarity}</span>
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-xl bg-raised p-4">
        {f.unlockable ? (
          <>
            <h4 className="text-sm font-semibold text-fg">Your progress</h4>
            {next ? (
              <div className="mt-3 flex items-center gap-3">
                <img src={(held ?? f.tiers[0]).iconUrl} alt="" className={clsx('h-8 w-8 [image-rendering:pixelated]', !held && 'opacity-40 grayscale')} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{remaining(f.criteriaType, Math.max(0, next.threshold - have))}</p>
                  <div role="progressbar" aria-label={`Progress to ${next.name}`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} className="mt-1.5 h-2 rounded-full bg-void">
                    <div className="h-2 rounded-full bg-brand" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <img src={next.iconUrl} alt="" className="h-8 w-8 [image-rendering:pixelated]" />
              </div>
            ) : (
              <p className="mt-2 text-sm text-fg">Highest level reached.</p>
            )}
            <hr className="my-4 border-line" />
            {f.hint && <p className="text-sm font-medium text-fg">{f.hint}</p>}
            <ol aria-label="Levels" className="mt-4 grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4">
              {f.tiers.map((t) => {
                const got = !!owned[t.code];
                return (
                  <li key={t.code} aria-label={`${t.name}${got ? '' : ', locked'}`} className={clsx('flex flex-col items-center text-center', !got && 'opacity-45')}>
                    <img src={t.iconUrl} alt="" className={clsx('h-8 w-8 [image-rendering:pixelated]', !got && 'grayscale-[60%]')} />
                    <span className="mt-1 text-xs font-semibold text-fg">{t.name}</span>
                    <span className="flex items-center gap-0.5 text-[11px] text-fg-muted">
                      {!got && <Lock className="h-2.5 w-2.5" aria-hidden />}
                      {requirement(f.criteriaType, t.threshold)}
                    </span>
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <p className="text-sm text-fg">{top.description} This badge is granted, not unlocked.</p>
        )}
      </div>
    </div>
  );
}

function Customize({ families, owned, onBack, onToggle }: { families: Family[]; owned: Record<string, Owned>; onBack: () => void; onToggle: (f: Family, visible: boolean) => void }) {
  return (
    <div aria-label="Customize your badges">
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <h3 className="text-lg font-semibold text-fg">Customize your badges</h3>
      <p className="mt-1 text-sm text-fg-muted">Choose which badges show on your profile. Levelled badges show your highest level.</p>
      <ul className="mt-4">
        {families.map((f) => {
          const t = shownTier(f, owned);
          const visible = f.tiers.some((x) => owned[x.code]?.isVisible);
          return (
            <li key={f.family} aria-label={t.name} className="flex items-center gap-3">
              <img src={t.iconUrl} alt="" className="h-8 w-8 shrink-0 [image-rendering:pixelated]" />
              <div className="min-w-0 flex-1">
                <Switch
                  label={t.name}
                  description={f.criteriaType === 'staff' ? 'The staff badge always shows.' : undefined}
                  checked={visible}
                  disabled={f.criteriaType === 'staff'}
                  onChange={(v) => onToggle(f, v)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
