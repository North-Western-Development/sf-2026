import { create } from 'zustand';

export type ModalState =
  | { kind: 'userSettings'; tab?: string }
  | { kind: 'beaconSettings'; beaconId: string; tab?: string }
  | { kind: 'createBeacon' }
  | { kind: 'createRelay'; beaconId: string; parentId?: string | null; type?: string }
  | { kind: 'createBand'; beaconId: string }
  | { kind: 'invite'; beaconId: string; relayId?: string }
  | { kind: 'profile'; userId: string; beaconId?: string }
  | { kind: 'notificationSettings'; beaconId: string }
  | { kind: 'createMesh' }
  | { kind: 'addAffiliate' }
  | { kind: 'confirm'; title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<void> | void }
  | { kind: 'prompt'; title: string; label: string; initial?: string; maxLength?: number; confirmLabel?: string; onSubmit: (value: string) => Promise<void> | void }
  | { kind: 'quickScan' }
  | { kind: 'vault' }
  | { kind: 'drivePicker'; onPick: (file: { id: string; filename: string }) => void }
  | { kind: 'console' }
  | { kind: 'report'; targetType: 'transmission' | 'transmitter' | 'beacon'; targetId: string; context?: Record<string, unknown> };

export interface PopoutState {
  userId: string;
  beaconId?: string;
  /** Anchor rect in viewport coordinates. */
  rect: { top: number; left: number; right: number; bottom: number };
  side: 'right' | 'left';
}

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error' | 'success';
}

export type DialogState = Extract<ModalState, { kind: 'confirm' } | { kind: 'prompt' }>;

interface UiState {
  modal: ModalState | null;
  /** Confirm / prompt dialogs stack above any modal or settings screen. */
  dialog: DialogState | null;
  popout: PopoutState | null;
  memberListOpen: boolean;
  collapsedBands: Record<string, boolean>;
  openClusters: Record<string, boolean>;
  toasts: Toast[];
  replyingTo: Record<string, { messageId: string; ping: boolean } | undefined>;
  editing: { key: string; messageId: string } | null;
  /** Open search panel: scope is a beacon id or 'dms'. */
  search: SearchState | null;
  /** A message to scroll to once its channel is showing. */
  jumpTarget: { key: string; messageId: string } | null;
  /** Small screens: the beacon rail and sidebar drawer is open. */
  mobileNav: boolean;
}

export interface SearchState {
  scope: string;
  query: string;
  sort: 'newest' | 'oldest';
  page: number;
}

const persisted = (() => {
  try {
    return JSON.parse(localStorage.getItem('subspace_ui') || '{}');
  } catch {
    return {};
  }
})();

export const useUi = create<UiState>()(() => ({
  modal: null,
  dialog: null,
  popout: null,
  memberListOpen: persisted.memberListOpen ?? true,
  collapsedBands: persisted.collapsedBands ?? {},
  openClusters: persisted.openClusters ?? {},
  toasts: [],
  replyingTo: {},
  editing: null,
  search: null,
  jumpTarget: null,
  mobileNav: false,
}));

useUi.subscribe((s) => {
  try {
    localStorage.setItem(
      'subspace_ui',
      JSON.stringify({ memberListOpen: s.memberListOpen, collapsedBands: s.collapsedBands, openClusters: s.openClusters })
    );
  } catch {
    /* ignore */
  }
});

export const openModal = (modal: ModalState) => useUi.setState({ modal, popout: null });
export const closeModal = () => useUi.setState({ modal: null });
export const openPopout = (p: PopoutState) => useUi.setState({ popout: p });
export const closePopout = () => useUi.setState({ popout: null });

let toastId = 0;
export function toast(message: string, tone: Toast['tone'] = 'info') {
  const id = ++toastId;
  useUi.setState((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
  setTimeout(() => useUi.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
}

export function confirmAction(opts: Omit<Extract<ModalState, { kind: 'confirm' }>, 'kind'>) {
  useUi.setState({ dialog: { kind: 'confirm', ...opts }, popout: null });
}

export function promptText(opts: Omit<Extract<ModalState, { kind: 'prompt' }>, 'kind'>) {
  useUi.setState({ dialog: { kind: 'prompt', ...opts }, popout: null });
}

export const closeDialog = () => useUi.setState({ dialog: null });

/** Last visited relay per beacon, so returning to a beacon restores its channel. */
export function rememberRelay(beaconId: string, relayId: string) {
  try {
    const map = JSON.parse(localStorage.getItem('subspace_last_relay') || '{}');
    map[beaconId] = relayId;
    localStorage.setItem('subspace_last_relay', JSON.stringify(map));
  } catch {
    /* ignore */
  }
}
export function lastRelay(beaconId: string): string | undefined {
  try {
    return JSON.parse(localStorage.getItem('subspace_last_relay') || '{}')[beaconId];
  } catch {
    return undefined;
  }
}
