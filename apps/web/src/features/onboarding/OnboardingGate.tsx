import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { ShieldCheck, Check } from 'lucide-react';
import { Button, Modal } from '@subspace/ui';
import { useStore, setState } from '../../data/store';
import { http } from '../../lib/http';
import { term } from '../../lib/strings';
import { toast } from '../../app/ui';
import { Markdown } from '../chat/markdown';

interface OnboardingInfo {
  beaconName: string;
  rulesText: string | null;
  hasCompletedOnboarding: boolean;
  optInClearances: Array<{ id: string; name: string; color: string }>;
}

/** True when the signed-in member still has to accept this beacon's rules. */
export function useNeedsOnboarding(beaconId?: string): boolean {
  return useStore((s) => {
    if (!beaconId || !s.me) return false;
    if (s.beacons[beaconId]?.ownerId === s.me.id) return false;
    const m = s.members[beaconId]?.[s.me.id];
    return !!m && m.hasCompletedOnboarding === false;
  });
}

/**
 * Discord's rules screening: replaces the composer until the member accepts the beacon
 * rules (and optionally picks opt-in clearances).
 */
export function OnboardingGate({ beaconId }: { beaconId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-4 pb-6">
      <div className="flex items-center gap-3 rounded-lg border border-brand/40 bg-brand-soft px-4 py-3">
        <ShieldCheck className="h-5 w-5 shrink-0 text-brand-sky" />
        <p className="flex-1 text-sm text-fg">Accept this {term('beacon').toLowerCase()}'s rules to start transmitting.</p>
        <Button size="sm" onClick={() => setOpen(true)}>
          Complete
        </Button>
      </div>
      {open && <OnboardingModal beaconId={beaconId} onClose={() => setOpen(false)} />}
    </div>
  );
}

function OnboardingModal({ beaconId, onClose }: { beaconId: string; onClose: () => void }) {
  const [info, setInfo] = useState<OnboardingInfo | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const meId = useStore((s) => s.me?.id);

  useEffect(() => {
    http
      .get<OnboardingInfo>(`/beacons/${beaconId}/onboarding`)
      .then(setInfo)
      .catch((err) => toast((err as Error).message, 'error'));
  }, [beaconId]);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await http.post<{ member: { clearanceIds: string[] } }>(`/beacons/${beaconId}/onboarding/complete`, {
        agreedToRules: true,
        selectedClearanceIds: picked,
      });
      if (meId) {
        setState((s) => {
          const m = s.members[beaconId]?.[meId];
          if (!m) return {};
          return { members: { ...s.members, [beaconId]: { ...s.members[beaconId], [meId]: { ...m, hasCompletedOnboarding: true, clearanceIds: res.member.clearanceIds } } } };
        });
      }
      toast(`Welcome aboard ${info?.beaconName ?? ''}!`, 'success');
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={info ? `Welcome to ${info.beaconName}` : 'Loading…'}
      description="Before you start transmitting, review the rules below."
      maxWidth="lg"
      footer={
        <Button onClick={submit} disabled={!agreed || !info} isLoading={busy}>
          Submit
        </Button>
      }
    >
      {info && (
        <>
          <section className="rounded-lg border border-line bg-raised p-4">
            <h3 className="mb-2 text-xs font-bold uppercase text-fg-muted">{term('beacon')} Rules</h3>
            <div className="max-h-64 overflow-y-auto text-sm text-fg">
              <Markdown content={info.rulesText || 'Be respectful. Follow the Subspace Directives.'} />
            </div>
          </section>
          {info.optInClearances.length > 0 && (
            <section className="mt-4">
              <h3 className="mb-2 text-xs font-bold uppercase text-fg-muted">Pick your {term('clearance', true).toLowerCase()}</h3>
              <div className="flex flex-wrap gap-2">
                {info.optInClearances.map((c) => {
                  const on = picked.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPicked((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))}
                      className={clsx('flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm', on ? 'border-brand bg-brand-soft text-fg' : 'border-line-strong text-fg-muted hover:bg-hover')}
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                      {c.name}
                      {on && <Check className="h-3.5 w-3.5" />}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-sm text-fg">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand)]" />
            I have read and agree to the rules
          </label>
        </>
      )}
    </Modal>
  );
}
