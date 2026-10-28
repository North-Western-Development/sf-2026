// The counter activity's backend: serves the page and exchanges sdk.authorize() codes.
//
//   SUBSPACE_URL=https://subspace.click CLIENT_ID=... CLIENT_SECRET=... node server.mjs
//
// Put it behind https (an Activity URL must be https). Node 18+, no dependencies.
import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

const SUBSPACE_URL = (process.env.SUBSPACE_URL || 'https://subspace.click').replace(/\/$/, '');
const { CLIENT_ID, CLIENT_SECRET } = process.env;
const PORT = Number(process.env.PORT || 8787);
if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('Set CLIENT_ID and CLIENT_SECRET (Developer Applications)');

const here = (f) => new URL(f, import.meta.url);
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/main.js': ['main.js', 'text/javascript'],
  // The built SDK: `pnpm build` in packages/activity-sdk, or node_modules/@subspace/activity-sdk/dist/index.js.
  '/sdk.js': ['../../dist/index.js', 'text/javascript'],
};

const headers = (type) => ({
  'content-type': type,
  // Only Subspace may frame this page (the SDK checks too, but this stops other sites outright).
  'content-security-policy': `frame-ancestors ${SUBSPACE_URL}; default-src 'self'; img-src 'self' ${SUBSPACE_URL} data:; style-src 'self' 'unsafe-inline'`,
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
});

/** Your sessions: who each one proved to be. Use a real store in production. */
const sessions = new Map();

async function exchange(code) {
  // The code has no redirect_uri: leave it out of the token request.
  const token = await fetch(`${SUBSPACE_URL}/api/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code }),
  });
  if (!token.ok) throw new Error(`token: ${token.status} ${await token.text()}`);
  const { access_token } = await token.json();
  const me = await fetch(`${SUBSPACE_URL}/api/v1/oauth2/@me`, { headers: { authorization: `Bearer ${access_token}` } }).then((r) => r.json());
  // Keep the access token here if you need it later. Never send it (or the secret) to the browser.
  return me.user;
}

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      if (req.method === 'GET' && url.pathname === '/config.json') {
        res.writeHead(200, headers('application/json'));
        return res.end(JSON.stringify({ clientId: CLIENT_ID, allowedOrigins: [SUBSPACE_URL] }));
      }
      if (req.method === 'POST' && url.pathname === '/api/session') {
        let body = '';
        for await (const chunk of req) if ((body += chunk).length > 4096) throw new Error('too large');
        const { code } = JSON.parse(body);
        if (typeof code !== 'string') throw new Error('code is required');
        const user = await exchange(code);
        const id = crypto.randomBytes(24).toString('base64url');
        sessions.set(id, user);
        // SameSite=None + Partitioned: the page is a third-party frame inside Subspace.
        res.writeHead(200, { ...headers('application/json'), 'set-cookie': `sid=${id}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned` });
        return res.end(JSON.stringify({ user: { id: user.id, username: user.username, displayName: user.displayName } }));
      }
      const file = req.method === 'GET' && FILES[url.pathname];
      if (!file) {
        res.writeHead(404, headers('text/plain'));
        return res.end('Not found');
      }
      res.writeHead(200, headers(file[1]));
      res.end(await readFile(here(file[0])));
    } catch (err) {
      res.writeHead(400, headers('text/plain'));
      res.end(String(err.message ?? err));
    }
  })
  .listen(PORT, () => console.log(`Counter activity on http://localhost:${PORT} (put https in front of it)`));
