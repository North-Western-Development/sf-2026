import http from 'node:http';
import crypto from 'node:crypto';

/**
 * A stand-in for Google Drive, OneDrive and Dropbox: their OAuth consent redirect, token
 * endpoint (with PKCE checks), and the list / metadata / download calls the file service makes.
 * Paths are the providers' own, prefixed with /google, /onedrive or /dropbox
 * (see DRIVE_MOCK_ORIGIN in apps/file-service/src/integrations/drives.ts).
 */

export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const LOG = Buffer.from('Stardate 2026.10: all systems nominal.\n');
const PDF = Buffer.from('%PDF-1.4\n% mock export\n');

interface MockFile {
  id: string;
  name: string;
  folder?: boolean;
  parent: string;
  mime?: string;
  body?: Buffer;
  size?: number;
}

/** The same tree in every drive. `big.bin` claims 60 MB so the size limit is exercised. */
const FILES: MockFile[] = [
  { id: 'fold-logs', name: 'Mission Logs', folder: true, parent: 'root' },
  { id: 'file-png', name: 'nebula.png', parent: 'root', mime: 'image/png', body: PNG },
  { id: 'file-big', name: 'big.bin', parent: 'root', mime: 'application/octet-stream', size: 60 * 1024 * 1024 },
  { id: 'file-doc', name: 'Briefing', parent: 'root', mime: 'application/vnd.google-apps.document' },
  { id: 'file-log', name: 'log.txt', parent: 'fold-logs', mime: 'text/plain', body: LOG },
];
const sizeOf = (f: MockFile) => f.size ?? f.body?.length ?? 0;

export interface MockDrives {
  origin: string;
  /** Requests seen, e.g. to assert a token was revoked. */
  log: string[];
  close(): Promise<void>;
}

export async function startMockDrives(port = 0): Promise<MockDrives> {
  const codes = new Map<string, { challenge: string; redirect: string }>();
  const accessTokens = new Set<string>();
  const log: string[] = [];

  const readBody = (req: http.IncomingMessage) =>
    new Promise<string>((resolve) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => resolve(b));
    });
  const send = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    const isBuf = Buffer.isBuffer(body);
    res.writeHead(status, { 'content-type': isBuf ? 'application/octet-stream' : 'application/json', ...headers });
    res.end(isBuf ? body : JSON.stringify(body));
  };
  const authed = (req: http.IncomingMessage) => accessTokens.has(String(req.headers.authorization || '').replace(/^Bearer /, ''));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://mock');
    const [, provider, ...rest] = url.pathname.split('/');
    const path = `/${rest.join('/')}`;
    log.push(`${req.method} /${provider}${path}`);

    // Consent screens: approve immediately and bounce back with a code.
    if (/\/(o\/oauth2\/v2\/auth|common\/oauth2\/v2\.0\/authorize|oauth2\/authorize)$/.test(path)) {
      const redirect = url.searchParams.get('redirect_uri')!;
      const code = `${provider}-code-${crypto.randomBytes(6).toString('hex')}`;
      codes.set(code, { challenge: url.searchParams.get('code_challenge')!, redirect });
      res.writeHead(302, { location: `${redirect}?code=${code}&state=${encodeURIComponent(url.searchParams.get('state')!)}` });
      return res.end();
    }

    // Token endpoints: check PKCE and the redirect URI like the real ones do.
    if (/\/(token|oauth2\/token|common\/oauth2\/v2\.0\/token)$/.test(path) && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      if (!form.get('client_id') || !form.get('client_secret')) return send(res, 401, { error: 'invalid_client' });
      if (form.get('grant_type') === 'refresh_token') {
        if (!form.get('refresh_token')?.startsWith(`${provider}-refresh`)) return send(res, 400, { error: 'invalid_grant' });
      } else {
        const issued = codes.get(form.get('code') || '');
        codes.delete(form.get('code') || '');
        const challenge = crypto.createHash('sha256').update(form.get('code_verifier') || '').digest('base64url');
        if (!issued || issued.challenge !== challenge || issued.redirect !== form.get('redirect_uri')) return send(res, 400, { error: 'invalid_grant' });
      }
      const access = `${provider}-access-${crypto.randomBytes(6).toString('hex')}`;
      accessTokens.add(access);
      return send(res, 200, { access_token: access, refresh_token: `${provider}-refresh-1`, expires_in: 3600, token_type: 'bearer' });
    }
    if (path === '/revoke' || path === '/2/auth/token/revoke') return send(res, 200, {});

    // OneDrive's pre-authenticated download host (no bearer needed).
    if (provider === 'onedrive' && path.startsWith('/cdn/')) {
      const f = FILES.find((x) => x.id === path.slice(5));
      return f?.body ? send(res, 200, f.body) : send(res, 404, {});
    }

    if (!authed(req)) return send(res, 401, { error: 'unauthorized' });

    if (provider === 'google') {
      if (path === '/drive/v3/about') return send(res, 200, { user: { emailAddress: 'pilot@gmail.test' } });
      if (path === '/drive/v3/files') {
        const q = url.searchParams.get('q') || '';
        const parent = /'([^']+)' in parents/.exec(q)?.[1];
        const name = /name contains '([^']+)'/.exec(q)?.[1]?.toLowerCase();
        const list = FILES.filter((f) => (parent ? f.parent === parent : name ? f.name.toLowerCase().includes(name) : false));
        return send(res, 200, {
          files: list.map((f) => ({
            id: f.id,
            name: f.name,
            mimeType: f.folder ? 'application/vnd.google-apps.folder' : f.mime,
            ...(f.folder || f.mime?.startsWith('application/vnd.google-apps') ? {} : { size: String(sizeOf(f)) }),
            modifiedTime: '2026-10-20T10:00:00Z',
          })),
        });
      }
      const m = /^\/drive\/v3\/files\/([^/]+)(\/export)?$/.exec(path);
      const f = m && FILES.find((x) => x.id === decodeURIComponent(m[1]));
      if (!f) return send(res, 404, {});
      if (m![2]) return send(res, 200, PDF, { 'content-type': 'application/pdf' });
      if (url.searchParams.get('alt') === 'media') return f.body ? send(res, 200, f.body, { 'content-type': f.mime! }) : send(res, 404, {});
      return send(res, 200, { id: f.id, name: f.name, mimeType: f.folder ? 'application/vnd.google-apps.folder' : f.mime, ...(f.body || f.size ? { size: String(sizeOf(f)) } : {}) });
    }

    if (provider === 'onedrive') {
      const item = (f: MockFile) => ({
        id: f.id,
        name: f.name,
        size: sizeOf(f),
        lastModifiedDateTime: '2026-10-20T10:00:00Z',
        ...(f.folder ? { folder: { childCount: 1 } } : { file: { mimeType: f.mime } }),
      });
      if (path === '/v1.0/me') return send(res, 200, { mail: 'pilot@outlook.test' });
      const children = /^\/v1\.0\/me\/drive\/(?:root|items\/([^/]+))\/children$/.exec(path);
      if (children) return send(res, 200, { value: FILES.filter((f) => f.parent === (children[1] ? decodeURIComponent(children[1]) : 'root') && !f.mime?.startsWith('application/vnd.google-apps')).map(item) });
      const search = /^\/v1\.0\/me\/drive\/root\/search\(q='(.*)'\)$/.exec(decodeURIComponent(path));
      if (search) return send(res, 200, { value: FILES.filter((f) => f.name.toLowerCase().includes(search[1].toLowerCase())).map(item) });
      const content = /^\/v1\.0\/me\/drive\/items\/([^/]+)\/content$/.exec(path);
      if (content) {
        res.writeHead(302, { location: `/onedrive/cdn/${content[1]}` });
        return res.end();
      }
      const one = /^\/v1\.0\/me\/drive\/items\/([^/]+)$/.exec(path);
      const f = one && FILES.find((x) => x.id === decodeURIComponent(one[1]));
      return f ? send(res, 200, item(f)) : send(res, 404, {});
    }

    if (provider === 'dropbox') {
      const body = req.method === 'POST' ? await readBody(req) : '';
      const args = body ? JSON.parse(body) : {};
      const entry = (f: MockFile) => ({ '.tag': f.folder ? 'folder' : 'file', id: `id:${f.id}`, name: f.name, ...(f.folder ? {} : { size: sizeOf(f), server_modified: '2026-10-20T10:00:00Z' }) });
      const byId = (id: string) => FILES.find((f) => `id:${f.id}` === id);
      const visible = FILES.filter((f) => !f.mime?.startsWith('application/vnd.google-apps'));
      if (path === '/2/users/get_current_account') return send(res, 200, { email: 'pilot@dropbox.test' });
      if (path === '/2/files/list_folder') {
        const parent = args.path ? byId(args.path)?.id : 'root';
        return send(res, 200, { entries: visible.filter((f) => f.parent === parent).map(entry), has_more: false, cursor: 'c1' });
      }
      if (path === '/2/files/search_v2') return send(res, 200, { matches: visible.filter((f) => f.name.toLowerCase().includes(String(args.query).toLowerCase())).map((f) => ({ metadata: { metadata: entry(f) } })) });
      if (path === '/2/files/get_metadata') {
        const f = byId(args.path);
        return f ? send(res, 200, entry(f)) : send(res, 409, { error_summary: 'path/not_found/' });
      }
      if (path === '/2/files/download') {
        const f = byId(JSON.parse(String(req.headers['dropbox-api-arg'] || '{}')).path);
        return f?.body ? send(res, 200, f.body) : send(res, 409, {});
      }
    }
    send(res, 404, { error: 'mock: unknown route' });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address() as { port: number };
  return {
    origin: `http://127.0.0.1:${address.port}`,
    log,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
