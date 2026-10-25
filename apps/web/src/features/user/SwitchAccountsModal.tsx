import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button, Modal } from '@subspace/ui';
import { api, MAX_ACCOUNTS } from '../../services/api';
import { gateway } from '../../services/gateway';
import { closeModal } from '../../app/ui';
import { useStore } from '../../data/store';
import { userTag } from '../../lib/normalize';
import { Avatar } from '../common/Avatar';

/** Reload into another account: every store, socket and key belongs to the old one. */
function reloadAs(path: string) {
  gateway.disconnect();
  window.location.assign(path);
}

/**
 * Switch Accounts (Discord's): up to five accounts stay signed in on this device. Switching
 * reloads the app as the other account; Log Out ends that account's session for good.
 */
export function SwitchAccountsModal() {
  const meId = useStore((s) => s.me?.id);
  const [accounts, setAccounts] = useState(() => api.savedAccounts());
  const others = accounts.filter((a) => a.transmitter.id !== meId);
  const current = accounts.find((a) => a.transmitter.id === meId);
  const ordered = current ? [current, ...others] : others;

  const switchTo = (id: string) => {
    if (api.switchAccount(id)) reloadAs('/channels/@me');
  };
  const forget = async (id: string) => {
    await api.forgetAccount(id);
    setAccounts(api.savedAccounts());
  };

  return (
    <Modal isOpen onClose={closeModal} title="Manage Accounts" description="Switch between accounts signed in on this device." maxWidth="md">
      <ul aria-label="Accounts" className="space-y-1">
        {ordered.map(({ transmitter: t }) => {
          const active = t.id === meId;
          return (
            <li key={t.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-hover">
              <Avatar user={{ id: t.id, username: t.username, displayName: t.displayName ?? null, avatarUrl: t.avatarUrl ?? null }} size={40} decoration={false} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-fg">{t.displayName || t.username}</p>
                <p className="truncate text-sm text-fg-muted">{userTag({ username: t.username, discriminator: (t as { discriminator?: string }).discriminator ?? '0000' })}</p>
              </div>
              {active ? (
                <span className="flex items-center gap-1 text-sm font-medium text-online">
                  <Check className="h-4 w-4" /> Active
                </span>
              ) : (
                <>
                  <Button size="sm" onClick={() => switchTo(t.id)} aria-label={`Switch to ${t.displayName || t.username}`}>
                    Switch
                  </Button>
                  <button
                    type="button"
                    aria-label={`Log out of ${t.displayName || t.username}`}
                    onClick={() => void forget(t.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-active hover:text-danger"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <div className="-mx-6 -mb-4 mt-6 flex items-center justify-between gap-3 bg-raised px-6 py-4">
        <span className="text-xs text-fg-subtle">
          {ordered.length}/{MAX_ACCOUNTS} accounts
        </span>
        <Button
          disabled={ordered.length >= MAX_ACCOUNTS}
          onClick={() => {
            api.stepOutForNewAccount();
            reloadAs('/channels/@me');
          }}
        >
          Add an Account
        </Button>
      </div>
    </Modal>
  );
}
