import { http, optional } from '../lib/http';
import type { NotificationScope, NotificationSetting } from '../lib/types';
import { getState, setState } from './store';

const DEFAULTS: Omit<NotificationSetting, 'scopeType' | 'scopeId'> = {
  level: 'inherit',
  mutedUntil: null,
  suppressEveryone: false,
  suppressRoles: false,
  suppressHighlights: false,
  mobilePush: true,
};

/** Optimistically update a scope's notification setting and persist it. */
export async function setNotificationSetting(
  scopeType: NotificationScope,
  scopeId: string,
  patch: Partial<Omit<NotificationSetting, 'scopeType' | 'scopeId'>>
) {
  const key = `${scopeType}:${scopeId}`;
  const prev = getState().notificationSettings[key];
  const next: NotificationSetting = { ...DEFAULTS, ...prev, ...patch, scopeType, scopeId };
  setState((s) => ({ notificationSettings: { ...s.notificationSettings, [key]: next } }));
  try {
    await optional(http.put(`/notification-settings/${scopeType}/${encodeURIComponent(scopeId)}`, patch), undefined);
  } catch (err) {
    setState((s) => {
      const notificationSettings = { ...s.notificationSettings };
      if (prev) notificationSettings[key] = prev;
      else delete notificationSettings[key];
      return { notificationSettings };
    });
    throw err;
  }
}

export function muteDurations(): Array<{ label: string; until: () => string }> {
  const at = (ms: number) => () => new Date(Date.now() + ms).toISOString();
  return [
    { label: 'For 15 Minutes', until: at(15 * 60e3) },
    { label: 'For 1 Hour', until: at(60 * 60e3) },
    { label: 'For 3 Hours', until: at(3 * 60 * 60e3) },
    { label: 'For 8 Hours', until: at(8 * 60 * 60e3) },
    { label: 'For 24 Hours', until: at(24 * 60 * 60e3) },
    { label: 'Until I turn it back on', until: () => 'infinity' },
  ];
}
