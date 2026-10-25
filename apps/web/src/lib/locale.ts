import { create } from 'zustand';

/** Language & Time (User Settings): how dates and times are written on this device. */
export interface LocalePrefs {
  /** A BCP 47 region for date and time formats, or 'auto' for the browser's. */
  region: string;
  /** 12- or 24-hour clock, or 'auto' for the region's custom. */
  clock: 'auto' | '12' | '24';
}

const KEY = 'subspace_locale_prefs';
const defaults: LocalePrefs = { region: 'auto', clock: 'auto' };

export const REGIONS: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'Use my browser’s setting' },
  { value: 'en-US', label: 'English (United States)' },
  { value: 'en-GB', label: 'English (United Kingdom)' },
  { value: 'en-AU', label: 'English (Australia)' },
  { value: 'en-CA', label: 'English (Canada)' },
  { value: 'de-DE', label: 'Deutsch (Deutschland)' },
  { value: 'es-ES', label: 'Español (España)' },
  { value: 'fr-FR', label: 'Français (France)' },
  { value: 'ja-JP', label: '日本語 (日本)' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
];

const read = (): LocalePrefs => {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return defaults;
  }
};

export const useLocalePrefs = create<LocalePrefs>()(read);

export function setLocalePrefs(patch: Partial<LocalePrefs>) {
  useLocalePrefs.setState(patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(useLocalePrefs.getState()));
  } catch {
    /* storage unavailable */
  }
}

/** The locale to format with (undefined means the browser's). */
export const locale = () => {
  const r = useLocalePrefs.getState().region;
  return r === 'auto' ? undefined : r;
};

/** Options adding the chosen clock to a time format. */
export const clockOptions = (): Intl.DateTimeFormatOptions => {
  const c = useLocalePrefs.getState().clock;
  return c === 'auto' ? {} : { hour12: c === '12' };
};
