import { toast } from '../app/ui';

/** The pre-Clipboard-API path: select a hidden textarea and run the copy command. */
function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  const active = document.activeElement as HTMLElement | null;
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  active?.focus?.();
  return ok;
}

/**
 * Copies text and says whether it worked. The Clipboard API can be refused (no focus,
 * permissions policy, some embedded browsers and WebViews), so fall back to the copy command.
 * Shows `success` as a toast when given, and an error toast when both paths fail.
 */
export async function copyText(text: string, success?: string): Promise<boolean> {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    ok = legacyCopy(text);
  }
  if (ok && success) toast(success, 'success');
  if (!ok) toast('Could not copy to the clipboard', 'error');
  return ok;
}
