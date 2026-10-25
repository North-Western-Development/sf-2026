// Notification level resolution, mention detection, and desktop/sound delivery.
import type { ChannelKey, NotificationLevel, NotificationSetting, Transmission } from '../lib/types';
import { parseChannelKey } from '../lib/types';
import { getState, type SubspaceState } from './store';

export function settingFor(s: SubspaceState, scope: string, id: string): NotificationSetting | undefined {
  return s.notificationSettings[`${scope}:${id}`];
}

export const isMuted = (setting?: NotificationSetting | null) =>
  !!setting?.mutedUntil && (setting.mutedUntil === 'infinity' || new Date(setting.mutedUntil).getTime() > Date.now());

/** Scopes from most to least specific for a channel. */
export function scopesFor(s: SubspaceState, key: ChannelKey): Array<[string, string]> {
  const { type, id } = parseChannelKey(key);
  if (type === 'link') return [['link', id], ['global', '@global']];
  if (type === 'mesh') return [['mesh', id], ['global', '@global']];
  const relay = type === 'relay' ? s.relays[id] : undefined;
  const scopes: Array<[string, string]> = [];
  if (relay) {
    scopes.push(['relay', relay.id]);
    if (relay.parentId) scopes.push(['category', relay.parentId]);
    scopes.push(['beacon', relay.beaconId]);
  }
  scopes.push(['global', '@global']);
  return scopes;
}

export interface EffectiveNotification {
  level: Exclude<NotificationLevel, 'inherit'>;
  muted: boolean;
  suppressEveryone: boolean;
  suppressRoles: boolean;
}

export function effectiveNotification(s: SubspaceState, key: ChannelKey): EffectiveNotification {
  const scopes = scopesFor(s, key);
  let level: NotificationLevel = 'inherit';
  let muted = false;
  let beaconSetting: NotificationSetting | undefined;
  for (const [scope, id] of scopes) {
    const setting = settingFor(s, scope, id);
    if (scope === 'beacon') beaconSetting = setting;
    if (isMuted(setting)) muted = true;
    if (level === 'inherit' && setting && setting.level !== 'inherit') level = setting.level;
  }
  const { type, id } = parseChannelKey(key);
  // A beacon's Default Notification Settings, when its admins set one (Engagement).
  const beaconDefault = type === 'relay' ? s.beacons[s.relays[id]?.beaconId ?? '']?.defaultNotifications : null;
  const fallback = type === 'link' || type === 'mesh' ? 'all' : beaconDefault ?? 'mentions';
  return {
    level: level === 'inherit' ? fallback : level,
    muted,
    suppressEveryone: !!beaconSetting?.suppressEveryone,
    suppressRoles: !!beaconSetting?.suppressRoles,
  };
}

/** Does this message ping the current user (after suppression settings)? DMs always count. */
export function mentionsMe(s: SubspaceState, key: ChannelKey, t: Transmission): boolean {
  const { type } = parseChannelKey(key);
  if ((type === 'link' || type === 'mesh') && s.me && t.author.id !== s.me.id) return true;
  return explicitlyMentionsMe(s, key, t);
}

/** Explicit @user / @clearance / @everyone pings: these get the highlighted background. */
export function explicitlyMentionsMe(s: SubspaceState, key: ChannelKey, t: Transmission): boolean {
  const me = s.me;
  if (!me || t.author.id === me.id) return false;
  if (t.mentions.includes(me.id)) return true;
  const eff = effectiveNotification(s, key);
  if (t.mentionEveryone && !eff.suppressEveryone) return true;
  if (t.mentionRoles.length && !eff.suppressRoles) {
    const relay = s.relays[parseChannelKey(key).id];
    const member = relay ? s.members[relay.beaconId]?.[me.id] : undefined;
    if (member && t.mentionRoles.some((r) => member.clearanceIds.includes(r))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

let audioCtx: AudioContext | null = null;

/** Short two-tone chime synthesized on the fly (no asset needed). */
export function playPing() {
  try {
    audioCtx ??= new AudioContext();
    const now = audioCtx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, now + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.09 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.18);
      osc.connect(gain).connect(audioCtx!.destination);
      osc.start(now + i * 0.09);
      osc.stop(now + i * 0.09 + 0.2);
    });
  } catch {
    /* audio unavailable */
  }
}

export async function requestDesktopPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

export interface NotifyPrefs {
  desktop: boolean;
  sounds: boolean;
}

export function readNotifyPrefs(): NotifyPrefs {
  try {
    return { desktop: true, sounds: true, ...JSON.parse(localStorage.getItem('subspace_notify_prefs') || '{}') };
  } catch {
    return { desktop: true, sounds: true };
  }
}

export function writeNotifyPrefs(p: NotifyPrefs) {
  try {
    localStorage.setItem('subspace_notify_prefs', JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/**
 * Decide whether an incoming message should sound / show a desktop notification.
 * Badges are handled separately (unread + mention counts always accumulate).
 */
export function maybeNotify(key: ChannelKey, t: Transmission, title: string, onOpen: () => void) {
  const s = getState();
  const me = s.me;
  if (!me || t.author.id === me.id) return;
  // Join lines and setup tips are not worth a ping.
  if (t.type === 'system_join' || t.type === 'system_tips') return;
  if (s.presence[me.id]?.status === 'dnd') return;
  const viewing = s.activeChannel === key && document.visibilityState === 'visible' && document.hasFocus();
  if (viewing) return;
  const eff = effectiveNotification(s, key);
  if (eff.muted || eff.level === 'nothing') return;
  if (eff.level === 'mentions' && !mentionsMe(s, key, t)) return;

  const prefs = readNotifyPrefs();
  if (prefs.sounds) playPing();
  if (prefs.desktop && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
    const n = new Notification(title, {
      body: t.content.slice(0, 180) || (t.attachments.length ? 'Sent an attachment' : ''),
      icon: t.author.avatarUrl ?? '/brand/star.png',
      tag: key,
    });
    n.onclick = () => {
      window.focus();
      onOpen();
      n.close();
    };
  }
}
