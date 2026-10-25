import { useState } from 'react';
import { Input } from '@subspace/ui';
import { useStore } from '../../../data/store';
import { term } from '../../../lib/strings';
import { Emoji } from '../../../lib/emoji';
import { EmojiPicker } from '../../chat/EmojiPicker';
import { UserName } from '../../common/UserName';
import { refreshBeaconTag } from '../../common/BeaconTag';
import { SettingsTitle, SettingsSection, SaveBar, Field, RowButton } from '../SettingsLayout';
import { useBeaconDraft } from './useBeaconDraft';

/** Discord's Server Tag: up to 4 characters and a badge that members can wear beside their name. */
export function TagTab({ beaconId }: { beaconId: string }) {
  const { d, set, dirty, saving, save, reset } = useBeaconDraft(beaconId, ['tag', 'tagBadge'] as const);
  const me = useStore((s) => s.me);
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const valid = !d.tag || /^[A-Za-z0-9]{2,4}$/.test(d.tag);
  return (
    <>
      <SettingsTitle>{term('beacon')} Tag</SettingsTitle>
      <p className="-mt-4 mb-6 text-sm text-fg-muted">
        Members can wear your {term('beacon').toLowerCase()}&apos;s tag beside their name everywhere on Subspace, and choose it in User Settings › Profiles.
      </p>
      <SettingsSection id="tag" title="Choose a name and badge">
        <div className="grid grid-cols-[1fr_auto] items-end gap-4">
          <Field label="Tag" hint="2 to 4 letters or numbers.">
            <Input aria-label="Tag" value={d.tag ?? ''} maxLength={4} onChange={(e) => set('tag', e.target.value.toUpperCase() || null)} />
          </Field>
          <Field label="Badge">
            <button
              type="button"
              aria-label="Choose badge"
              onClick={(e) => setPicker(e.currentTarget.getBoundingClientRect())}
              className="flex h-10 w-14 items-center justify-center rounded-md border border-line bg-void hover:border-fg-subtle"
            >
              {d.tagBadge ? <Emoji emoji={d.tagBadge} size={22} /> : <span className="text-fg-subtle">+</span>}
            </button>
          </Field>
        </div>
        {!valid && <p className="-mt-3 mb-3 text-sm text-danger">A tag is 2 to 4 letters or numbers.</p>}
        {d.tag && (
          <div className="rounded-lg bg-raised p-4">
            <p className="mb-2 text-xs font-bold uppercase text-fg-subtle">Preview</p>
            <span className="flex items-center gap-2">
              {me && <UserName user={me} className="font-medium" />}
              <span className="inline-flex h-[18px] items-center gap-1 rounded-[4px] bg-active px-1 text-[11px] font-semibold text-fg">
                {d.tagBadge && <Emoji emoji={d.tagBadge} size={12} />}
                {d.tag}
              </span>
            </span>
          </div>
        )}
        {(d.tag || d.tagBadge) && (
          <div className="mt-4">
            <RowButton
              onClick={() => {
                set('tag', null);
                set('tagBadge', null);
              }}
            >
              Remove Tag
            </RowButton>
          </div>
        )}
      </SettingsSection>
      {picker && (
        <EmojiPicker
          anchor={picker}
          glyphs="none"
          onClose={() => setPicker(null)}
          onPick={(emoji) => {
            set('tagBadge', emoji);
            setPicker(null);
          }}
        />
      )}
      <SaveBar
        visible={dirty && valid}
        saving={saving}
        onReset={reset}
        onSave={() =>
          void save().then(() => refreshBeaconTag(beaconId))
        }
      />
    </>
  );
}
