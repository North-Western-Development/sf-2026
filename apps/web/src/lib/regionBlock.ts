import { useEffect, useState } from 'react';

/**
 * The instance refuses visitors from the EU, the EEA and the UK (BLOCK_EU): every API request
 * answers 401 with code REGION_BLOCKED. The first such answer swaps the whole app for this page.
 */
let blocked = false;
const listeners = new Set<() => void>();

export function markRegionBlocked() {
  if (blocked) return;
  blocked = true;
  // The server's answer already tells the browser to drop cookies (Clear-Site-Data); expire any
  // a script can see too, for browsers without it.
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`;
  }
  listeners.forEach((l) => l());
}

/** Whether a response is the region block (reads a clone, so the caller can still use it). */
export async function isRegionBlockedResponse(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  const body = await res
    .clone()
    .json()
    .catch(() => null);
  return body?.code === 'REGION_BLOCKED';
}

export function useRegionBlocked(): boolean {
  const [value, setValue] = useState(blocked);
  useEffect(() => {
    const sync = () => setValue(blocked);
    listeners.add(sync);
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, []);
  return value;
}

/** Asks the API once at start-up, so a blocked visitor sees this page before anything else. */
export async function checkRegion() {
  try {
    if (await isRegionBlockedResponse(await fetch('/api/v1/system/info'))) markRegionBlocked();
  } catch {
    /* offline: the app shows its own errors */
  }
}
