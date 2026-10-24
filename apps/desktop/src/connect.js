// First-run screen of the desktop app: pick the Subspace instance, check it answers like one,
// then hand the address to the native side, which remembers it and opens it in this window.

const form = document.getElementById('connect');
const input = document.getElementById('server');
const error = document.getElementById('error');
const submit = document.getElementById('submit');

const invoke = window.__TAURI__?.core?.invoke;

function normalize(raw) {
  let value = raw.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    // Plain http only for this machine (local development).
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function showError(message) {
  error.textContent = message;
  error.hidden = !message;
}

async function looksLikeSubspace(origin) {
  const res = await fetch(`${origin}/api/v1/system/info`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return false;
  const info = await res.json().catch(() => null);
  return !!info && typeof info === 'object';
}

if (invoke) {
  invoke('current_server').then((server) => {
    if (server) input.value = server;
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  const origin = normalize(input.value);
  if (!origin) return showError('Enter an https:// address, like https://subspace.example.com.');
  submit.disabled = true;
  submit.textContent = 'Connecting…';
  try {
    if (!(await looksLikeSubspace(origin))) throw new Error('not subspace');
    if (!invoke) return window.location.assign(origin);
    await invoke('set_server', { url: origin });
  } catch {
    showError('That address did not answer like a Subspace Frequency server.');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Connect';
  }
});
