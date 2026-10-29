import { Emoji } from '../../lib/emoji';
import { useState } from 'react';
import { ChevronDown, Smile, X } from 'lucide-react';
import { Button, Modal, useContextMenu } from '@subspace/ui';
import { setState, useStore } from '../../data/store';
import { closeModal, toast } from '../../app/ui';
import { http } from '../../lib/http';
import type { CustomStatus } from '../../lib/types';
import { EmojiPicker } from '../chat/EmojiPicker';
import { useProfile } from '../profile/useProfile';
import { ProfileHeader, ProfileIdentity, StatusBubble } from '../profile/ProfileParts';
import { themeStyle } from '../profile/ProfilePopout';

const CLEAR_AFTER = [
  { label: "Don't clear", ms: 0 },
  { label: '30 minutes', ms: 30 * 60e3 },
  { label: '1 hour', ms: 60 * 60e3 },
  { label: '4 hours', ms: 4 * 60 * 60e3 },
  { label: 'Today', ms: -1 },
];

function expiryFor(ms: number): string | null {
  if (ms > 0) return new Date(Date.now() + ms).toISOString();
  if (ms < 0) {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return end.toISOString();
  }
  return null;
}

/** Saves (or clears, with null) my custom status and updates my presence locally. */
export async function saveCustomStatus(meId: string, status: CustomStatus | null) {
  await http.patch('/users/@me/status', { customStatus: status });
  setState((s) => ({
    presence: { ...s.presence, [meId]: { status: s.presence[meId]?.status ?? 'online', customStatus: status } },
    // The signed-in profile too: views fall back to it when presence has no status, so a cleared
    // status would otherwise come back from it.
    me: s.me?.id === meId ? { ...s.me, customStatus: status } : s.me,
  }));
}

/** Discord's "Set your status": a live preview of my card, the status field with an emoji, and when it clears. */
export function StatusModal() {
  const me = useStore((s) => s.me);
  const current = useStore((s) => (me ? s.presence[me.id]?.customStatus ?? me.customStatus : null));
  const profile = useProfile(me?.id ?? '');
  const [text, setText] = useState(current?.text ?? '');
  const [emoji, setEmoji] = useState(current?.emoji && !current.emoji.startsWith('custom:') ? current.emoji : '');
  const [clearAfter, setClearAfter] = useState(0);
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const [busy, setBusy] = useState(false);
  const { openContextMenu } = useContextMenu();
  if (!me || !profile) return null;

  const draft: CustomStatus | null = text.trim() || emoji ? { text: text.trim(), emoji: emoji || undefined } : null;
  const save = async () => {
    setBusy(true);
    try {
      await saveCustomStatus(me.id, draft ? { ...draft, expiresAt: expiryFor(CLEAR_AFTER[clearAfter].ms) } : null);
      closeModal();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={closeModal}
      title="Set your status"
      maxWidth="lg"
      footer={
        <div className="flex w-full items-center justify-between">
          <button
            type="button"
            aria-label={`Clear after: ${CLEAR_AFTER[clearAfter].label}`}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              openContextMenu(
                { clientX: r.left, clientY: r.bottom + 4 },
                CLEAR_AFTER.map((c, i) => ({ label: c.label, checked: i === clearAfter, onClick: () => setClearAfter(i) }))
              );
            }}
            className="flex items-center gap-1 text-sm font-medium text-fg hover:underline"
          >
            {CLEAR_AFTER[clearAfter].label}
            <ChevronDown className="h-4 w-4" />
          </button>
          <Button onClick={() => void save()} isLoading={busy}>
            Save
          </Button>
        </div>
      }
    >
      <div className="mx-auto mb-6 w-[340px] max-w-full overflow-hidden rounded-xl bg-overlay shadow-pop ring-1 ring-line" style={themeStyle(profile)}>
        <ProfileHeader profile={profile} bubble={<StatusBubble userId={me.id} draft={draft} placeholder="What's on your mind?" />} />
        <div className="px-4 pb-4">
          <ProfileIdentity profile={profile} maxBadges={8} />
        </div>
      </div>

      <label htmlFor="status-text" className="mb-2 block text-sm font-semibold text-fg">
        Status
      </label>
      <div className="flex h-11 items-center gap-2 rounded-lg bg-void px-2 ring-1 ring-line focus-within:ring-brand-sky">
        <button
          type="button"
          aria-label={emoji ? `Status emoji ${emoji}. Change it` : 'Pick a status emoji'}
          onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
        >
          {emoji ? <Emoji emoji={emoji} size={22} /> : <Smile className="h-5 w-5" />}
        </button>
        <input
          id="status-text"
          autoFocus
          value={text}
          maxLength={128}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          placeholder="Support has arrived!"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-subtle"
        />
        {(text || emoji) && (
          <button
            type="button"
            aria-label="Clear status"
            onClick={() => {
              setText('');
              setEmoji('');
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fg-subtle text-void hover:bg-fg-muted"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {picker && (
        <EmojiPicker
          anchor={picker}
          glyphs="none"
          onClose={() => setPicker(null)}
          onPick={(e) => {
            setEmoji(e);
            setPicker(null);
          }}
        />
      )}
    </Modal>
  );
}
