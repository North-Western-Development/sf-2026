import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { getState } from '../data/store';
import { ackBeacon, ackChannel } from '../data/actions';
import { channelIndicator } from '../data/selectors';
import { channelKey } from '../lib/types';
import { openModal, useUi } from './ui';

const inField = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/** Discord keyboard shortcuts: Ctrl+K, Alt+Up/Down, Alt+Shift+Up/Down, Esc, Shift+Esc, Ctrl+/. */
export function useGlobalShortcuts() {
  const navigate = useNavigate();
  const { beaconId, relayId } = useParams();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openModal({ kind: 'quickScan' });
        return;
      }
      if (useUi.getState().modal) return;

      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && beaconId && beaconId !== '@me') {
        e.preventDefault();
        const s = getState();
        const relays = (s.relayIdsByBeacon[beaconId] ?? [])
          .map((id) => s.relays[id])
          .filter((r) => r && r.type !== 'category' && !r.isHidden)
          .sort((a, b) => a.position - b.position);
        let candidates = relays;
        if (e.shiftKey) candidates = relays.filter((r) => r.id === relayId || channelIndicator(s, channelKey('relay', r.id)).unread);
        const i = candidates.findIndex((r) => r.id === relayId);
        const next = candidates[(i + (e.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length];
        if (next) navigate(`/channels/${beaconId}/${next.id}`);
        return;
      }

      if (e.key === 'Escape' && !inField(e.target)) {
        if (e.shiftKey && beaconId && beaconId !== '@me') void ackBeacon(beaconId);
        else {
          const key = getState().activeChannel;
          if (key) void ackChannel(key);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [beaconId, relayId, navigate]);
}
