import { useUi } from '../app/ui';

// Like Discord's "Leaving Discord" check: outside links ask first unless the domain is trusted.
const KEY = 'subspace_trusted_domains';

function trusted(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export function linkHost(href: string): string | null {
  try {
    const url = new URL(href, window.location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function isTrustedLink(href: string): boolean {
  const host = linkHost(href);
  if (!host) return true;
  if (host === window.location.hostname) return true;
  return trusted().some((d) => host === d || host.endsWith(`.${d}`));
}

export function trustDomain(host: string) {
  try {
    const list = trusted();
    if (!list.includes(host)) localStorage.setItem(KEY, JSON.stringify([...list, host]));
  } catch {
    /* ignore */
  }
}

export function openLeavingDialog(href: string) {
  useUi.setState({ dialog: { kind: 'leaving', href }, popout: null });
}
