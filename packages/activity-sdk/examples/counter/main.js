// A shared counter: everyone in the comm-link's activity sees the same number.
// State travels over sdk.broadcast() (Subspace relays small JSON between participants); a
// newcomer asks for the current count and the host answers. Anything that must not be cheated
// belongs on your backend instead, keyed by sdk.instance.id.
import { ActivitySdk } from './sdk.js';

const $ = (id) => document.getElementById(id);
const config = await fetch('./config.json').then((r) => r.json());
const sdk = new ActivitySdk({ clientId: config.clientId, allowedOrigins: config.allowedOrigins });

let count = 0;
const show = () => ($('count').textContent = String(count));

function renderPeople(people) {
  $('people').replaceChildren(
    ...people.map((p) => {
      const li = document.createElement('li');
      if (p.avatarUrl) {
        const img = document.createElement('img');
        img.src = p.avatarUrl;
        img.alt = '';
        li.append(img);
      }
      li.append(p.displayName || p.username); // textContent, never innerHTML: names are user input
      return li;
    })
  );
}

sdk.on('participants', renderPeople);
sdk.on('message', ({ payload }) => {
  if (payload?.type === 'set' && Number.isInteger(payload.count)) {
    count = payload.count;
    show();
  } else if (payload?.type === 'hello' && sdk.user?.id === sdk.instance?.hostId) {
    void sdk.broadcast({ type: 'set', count });
  }
});

try {
  await sdk.ready();
} catch (err) {
  $('status').textContent = `Open this from a Subspace comm-link (${err.code})`;
  throw err;
}
$('status').textContent = `Hi ${sdk.user.displayName || sdk.user.username} (not verified yet)`;
renderPeople(sdk.participants);
void sdk.broadcast({ type: 'hello' });

$('plus').onclick = () => {
  count += 1;
  show();
  void sdk.broadcast({ type: 'set', count });
};

// Who someone really is comes from your backend, never from sdk.user.
$('signin').onclick = async () => {
  try {
    const { code } = await sdk.authorize({ scopes: ['identify'] });
    const res = await fetch('./api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    if (!res.ok) throw new Error(await res.text());
    const { user } = await res.json();
    $('status').textContent = `Verified: ${user.username}`;
  } catch (err) {
    $('status').textContent = err.code === 'USER_CANCELLED' ? 'Maybe later.' : `Could not verify: ${err.message}`;
  }
};
