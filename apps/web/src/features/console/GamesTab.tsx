import { useEffect, useState, type FormEvent } from 'react';
import { Gamepad2, Trash2 } from 'lucide-react';
import { Button, Input } from '@subspace/ui';
import { DETECTED_GAMES } from '@subspace/constants';
import { http } from '../../lib/http';
import { confirmAction, toast } from '../../app/ui';
import { RowButton, SettingsSection } from '../settings/SettingsLayout';

interface VerifiedGame {
  game: string;
  application: { id: string; name: string; iconUrl: string | null; owner: string };
}

/**
 * Verified games: a developer's application linked to a game the desktop app detects. Its icon
 * then replaces the game's Steam cover for everyone who plays it.
 */
export function GamesTab() {
  const [games, setGames] = useState<VerifiedGame[] | null>(null);
  const [game, setGame] = useState('');
  const [applicationId, setApplicationId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    http.get<{ games: VerifiedGame[] }>('/console/verified-games').then((r) => setGames(r.games), (err) => toast((err as Error).message, 'error'));
  }, []);

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await http.put<{ games: VerifiedGame[] }>('/console/verified-games', { game, applicationId: applicationId.trim() });
      setGames(r.games);
      setGame('');
      setApplicationId('');
      toast(`Verified for ${game}`);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = (v: VerifiedGame) =>
    confirmAction({
      title: 'Remove Verification',
      body: `${v.game} goes back to its Steam cover, or the placeholder.`,
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: async () => {
        await http.delete(`/console/verified-games?game=${encodeURIComponent(v.game)}`);
        setGames((list) => list?.filter((g) => g.game !== v.game) ?? null);
      },
    });

  return (
    <SettingsSection
      title="Verified Games"
      description="Link a game's own application (from its developer's Developer Applications) to the game the desktop app detects. The application's icon then shows instead of the Steam cover. Check that the developer really makes the game first."
    >
      <form onSubmit={verify} aria-label="Verify a game" className="mb-6 grid gap-3 rounded-lg bg-raised p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Input label="Game" list="verifiable-games" value={game} onChange={(e) => setGame(e.target.value)} required />
        <datalist id="verifiable-games">
          {DETECTED_GAMES.map((g) => (
            <option key={g.name} value={g.name} />
          ))}
        </datalist>
        <Input label="Application ID" value={applicationId} onChange={(e) => setApplicationId(e.target.value)} inputMode="numeric" pattern="[1-9][0-9]{0,18}" required />
        <Button type="submit" disabled={busy}>
          Verify
        </Button>
      </form>
      {games === null ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : games.length === 0 ? (
        <p className="text-sm text-fg-muted">No games verified yet. Detected games show their Steam cover, or a placeholder.</p>
      ) : (
        <ul aria-label="Verified games" className="divide-y divide-line">
          {games.map((v) => (
            <li key={v.game} aria-label={v.game} className="flex items-center gap-3 py-3">
              {v.application.iconUrl ? (
                <img src={v.application.iconUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-active text-fg-muted">
                  <Gamepad2 className="h-5 w-5" aria-hidden />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg">{v.game}</p>
                <p className="truncate text-xs text-fg-muted">
                  {v.application.name} · {v.application.id} · by {v.application.owner}
                  {!v.application.iconUrl && ' · no icon yet, so the Steam cover still shows'}
                </p>
              </div>
              <RowButton danger onClick={() => remove(v)}>
                <span className="flex items-center gap-1.5">
                  <Trash2 className="h-4 w-4" /> Remove
                </span>
              </RowButton>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
