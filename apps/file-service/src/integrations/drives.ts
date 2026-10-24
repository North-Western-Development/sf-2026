/**
 * Cloud drive adapters: OAuth (authorization code + PKCE, confidential client), listing,
 * search and download for Google Drive, Microsoft OneDrive and Dropbox, behind one shape.
 *
 * DRIVE_MOCK_ORIGIN (ignored in production) points every provider host at a local mock,
 * so the test suites exercise the real request flow without real accounts.
 */

export type DriveProviderId = 'google' | 'onedrive' | 'dropbox';
export const DRIVE_PROVIDERS: DriveProviderId[] = ['google', 'onedrive', 'dropbox'];

export interface DriveTokens {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
}

export interface DriveItem {
  id: string;
  name: string;
  isFolder: boolean;
  mimeType?: string;
  size?: number;
  modifiedAt?: string;
  /** False for things that cannot become a file (e.g. Google Forms). */
  importable: boolean;
}

export interface DriveListing {
  items: DriveItem[];
  cursor?: string | null;
}

export interface DriveDownload {
  body: Buffer;
  filename: string;
  mimeType: string;
}

export class DriveError extends Error {
  constructor(message: string, public status = 502, public code = 'DRIVE_ERROR') {
    super(message);
  }
}

const mockOrigin = () => (process.env.NODE_ENV !== 'production' ? process.env.DRIVE_MOCK_ORIGIN?.replace(/\/$/, '') : undefined);
/** `https://host/path` → the mock's `/<provider>/path` when mocking. */
function at(provider: DriveProviderId, url: string) {
  const mock = mockOrigin();
  if (!mock) return url;
  const u = new URL(url);
  return `${mock}/${provider}${u.pathname}${u.search}`;
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', zip: 'application/zip',
};
/** A useful type for a downloaded file: the drive's, unless it only says octet-stream. */
export function guessMime(filename: string, reported?: string | null): string {
  const r = (reported || '').split(';')[0].trim();
  if (r && r !== 'application/octet-stream') return r;
  return MIME_BY_EXT[filename.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

function credentials(provider: DriveProviderId) {
  const env = process.env;
  const map = {
    google: [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET],
    onedrive: [env.ONEDRIVE_CLIENT_ID, env.ONEDRIVE_CLIENT_SECRET],
    dropbox: [env.DROPBOX_APP_KEY, env.DROPBOX_APP_SECRET],
  } as const;
  const [clientId, clientSecret] = map[provider];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export const isDriveConfigured = (provider: DriveProviderId) => !!credentials(provider);

async function call(provider: DriveProviderId, url: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  const res = await fetch(at(provider, url), { ...init, headers, signal: AbortSignal.timeout(20_000) });
  if (res.status === 401) throw new DriveError('The drive connection has expired. Connect it again.', 401, 'DRIVE_UNAUTHORIZED');
  if (res.status === 404) throw new DriveError('That item is no longer in the drive.', 404, 'DRIVE_NOT_FOUND');
  if (!res.ok) throw new DriveError(`The drive returned an error (${res.status}).`);
  return res;
}

const json = async <T = any>(provider: DriveProviderId, url: string, init: RequestInit & { token?: string } = {}): Promise<T> =>
  (await call(provider, url, init)).json() as Promise<T>;

/** Read a response body, refusing anything over `max` bytes. */
async function readCapped(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > max) throw new DriveError('File is larger than the 50 MB upload limit.', 400, 'FILE_TOO_LARGE');
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new DriveError('File is larger than the 50 MB upload limit.', 400, 'FILE_TOO_LARGE');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function tokenRequest(provider: DriveProviderId, url: string, form: Record<string, string>): Promise<DriveTokens> {
  const creds = credentials(provider);
  if (!creds) throw new DriveError('This drive is not configured on this instance.', 400, 'DRIVE_NOT_CONFIGURED');
  const res = await fetch(at(provider, url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, ...form }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !data.access_token) throw new DriveError('The drive did not accept the sign-in. Try connecting again.', 400, 'DRIVE_TOKEN_REJECTED');
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000) : null,
  };
}

export interface DriveAdapter {
  id: DriveProviderId;
  name: string;
  authorizeUrl(p: { redirectUri: string; state: string; challenge: string }): string;
  exchange(code: string, redirectUri: string, verifier: string): Promise<DriveTokens>;
  refresh(refreshToken: string): Promise<DriveTokens>;
  account(token: string): Promise<string | null>;
  list(token: string, opts: { folderId?: string; query?: string; cursor?: string }): Promise<DriveListing>;
  metadata(token: string, id: string): Promise<DriveItem>;
  download(token: string, item: DriveItem, maxBytes: number): Promise<DriveDownload>;
  revoke(token: string): Promise<void>;
}

// --- Google Drive ------------------------------------------------------------------------

const GOOGLE_API = 'https://www.googleapis.com/drive/v3';
const GOOGLE_EXPORT: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document': { mime: 'application/pdf', ext: 'pdf' },
  'application/vnd.google-apps.presentation': { mime: 'application/pdf', ext: 'pdf' },
  'application/vnd.google-apps.drawing': { mime: 'image/png', ext: 'png' },
  'application/vnd.google-apps.spreadsheet': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
};
const googleItem = (f: any): DriveItem => {
  const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
  const native = String(f.mimeType || '').startsWith('application/vnd.google-apps.');
  return {
    id: f.id,
    name: f.name,
    isFolder,
    mimeType: GOOGLE_EXPORT[f.mimeType]?.mime ?? f.mimeType,
    size: f.size ? Number(f.size) : undefined,
    modifiedAt: f.modifiedTime,
    importable: !isFolder && (!native || !!GOOGLE_EXPORT[f.mimeType]),
  };
};
const gq = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const google: DriveAdapter = {
  id: 'google',
  name: 'Google Drive',
  authorizeUrl: ({ redirectUri, state, challenge }) =>
    at(
      'google',
      `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: credentials('google')?.clientId ?? '',
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/drive.readonly email',
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })}`
    ),
  exchange: (code, redirectUri, verifier) =>
    tokenRequest('google', 'https://oauth2.googleapis.com/token', { code, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
  refresh: (refreshToken) => tokenRequest('google', 'https://oauth2.googleapis.com/token', { refresh_token: refreshToken, grant_type: 'refresh_token' }),
  async account(token) {
    const about = await json('google', `${GOOGLE_API}/about?fields=user(emailAddress,displayName)`, { token });
    return about.user?.emailAddress ?? about.user?.displayName ?? null;
  },
  async list(token, { folderId, query, cursor }) {
    const q = query ? `name contains '${gq(query)}' and trashed = false` : `'${gq(folderId || 'root')}' in parents and trashed = false`;
    const params = new URLSearchParams({
      q,
      pageSize: '50',
      orderBy: query ? 'modifiedTime desc' : 'folder,name',
      fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime)',
      ...(cursor ? { pageToken: cursor } : {}),
    });
    const data = await json('google', `${GOOGLE_API}/files?${params}`, { token });
    return { items: (data.files ?? []).map(googleItem), cursor: data.nextPageToken ?? null };
  },
  async metadata(token, id) {
    const f = await json('google', `${GOOGLE_API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime`, { token });
    return { ...googleItem(f), mimeType: f.mimeType };
  },
  async download(token, item, maxBytes) {
    const exported = GOOGLE_EXPORT[item.mimeType ?? ''];
    const url = exported
      ? `${GOOGLE_API}/files/${encodeURIComponent(item.id)}/export?mimeType=${encodeURIComponent(exported.mime)}`
      : `${GOOGLE_API}/files/${encodeURIComponent(item.id)}?alt=media`;
    const res = await call('google', url, { token });
    return {
      body: await readCapped(res, maxBytes),
      filename: exported ? `${item.name}.${exported.ext}` : item.name,
      mimeType: exported?.mime ?? guessMime(item.name, item.mimeType),
    };
  },
  async revoke(token) {
    await fetch(at('google', `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`), { method: 'POST' }).catch(() => {});
  },
};

// --- Microsoft OneDrive ------------------------------------------------------------------

const GRAPH = 'https://graph.microsoft.com/v1.0';
const MS_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const MS_SCOPES = 'offline_access Files.Read User.Read';
const graphItem = (f: any): DriveItem => ({
  id: f.id,
  name: f.name,
  isFolder: !!f.folder,
  mimeType: f.file?.mimeType,
  size: typeof f.size === 'number' ? f.size : undefined,
  modifiedAt: f.lastModifiedDateTime,
  importable: !f.folder && !!f.file,
});
const GRAPH_SELECT = '$select=id,name,size,file,folder,lastModifiedDateTime';

const onedrive: DriveAdapter = {
  id: 'onedrive',
  name: 'Microsoft OneDrive',
  authorizeUrl: ({ redirectUri, state, challenge }) =>
    at(
      'onedrive',
      `${MS_AUTH}/authorize?${new URLSearchParams({
        client_id: credentials('onedrive')?.clientId ?? '',
        redirect_uri: redirectUri,
        response_type: 'code',
        response_mode: 'query',
        scope: MS_SCOPES,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })}`
    ),
  exchange: (code, redirectUri, verifier) =>
    tokenRequest('onedrive', `${MS_AUTH}/token`, { code, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier, scope: MS_SCOPES }),
  refresh: (refreshToken) => tokenRequest('onedrive', `${MS_AUTH}/token`, { refresh_token: refreshToken, grant_type: 'refresh_token', scope: MS_SCOPES }),
  async account(token) {
    const me = await json('onedrive', `${GRAPH}/me?$select=displayName,userPrincipalName,mail`, { token });
    return me.mail ?? me.userPrincipalName ?? me.displayName ?? null;
  },
  async list(token, { folderId, query, cursor }) {
    let url: string;
    if (cursor) {
      // Paging links must stay on Graph.
      const next = new URL(cursor);
      if (next.hostname !== 'graph.microsoft.com' && next.origin !== mockOrigin()) throw new DriveError('Bad page cursor', 400, 'BAD_CURSOR');
      url = cursor;
    } else if (query) {
      url = `${GRAPH}/me/drive/root/search(q='${encodeURIComponent(query.replace(/'/g, "''"))}')?$top=50&${GRAPH_SELECT}`;
    } else {
      url = `${GRAPH}/me/drive/${folderId ? `items/${encodeURIComponent(folderId)}` : 'root'}/children?$top=50&${GRAPH_SELECT}`;
    }
    const data = await json('onedrive', url, { token });
    return { items: (data.value ?? []).map(graphItem), cursor: data['@odata.nextLink'] ?? null };
  },
  async metadata(token, id) {
    return graphItem(await json('onedrive', `${GRAPH}/me/drive/items/${encodeURIComponent(id)}?${GRAPH_SELECT}`, { token }));
  },
  async download(token, item, maxBytes) {
    // Graph answers with a redirect to a short-lived pre-authenticated download URL.
    const res = await call('onedrive', `${GRAPH}/me/drive/items/${encodeURIComponent(item.id)}/content`, { token });
    return { body: await readCapped(res, maxBytes), filename: item.name, mimeType: guessMime(item.name, item.mimeType) };
  },
  async revoke() {
    // Microsoft has no token revocation endpoint for this flow; dropping the tokens is enough.
  },
};

// --- Dropbox ------------------------------------------------------------------------------

const DBX_API = 'https://api.dropboxapi.com/2';
const dropboxItem = (f: any): DriveItem => ({
  id: f.id,
  name: f.name,
  isFolder: f['.tag'] === 'folder',
  size: typeof f.size === 'number' ? f.size : undefined,
  modifiedAt: f.server_modified,
  importable: f['.tag'] === 'file',
});
const dbxPost = (token: string, path: string, body?: unknown) =>
  json('dropbox', `${DBX_API}${path}`, {
    token,
    method: 'POST',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
// Dropbox-API-Arg must be ASCII; escape everything else as \uXXXX.
const dbxArg = (o: unknown) => JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

const dropbox: DriveAdapter = {
  id: 'dropbox',
  name: 'Dropbox',
  authorizeUrl: ({ redirectUri, state, challenge }) =>
    at(
      'dropbox',
      `https://www.dropbox.com/oauth2/authorize?${new URLSearchParams({
        client_id: credentials('dropbox')?.clientId ?? '',
        redirect_uri: redirectUri,
        response_type: 'code',
        token_access_type: 'offline',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })}`
    ),
  exchange: (code, redirectUri, verifier) =>
    tokenRequest('dropbox', 'https://api.dropboxapi.com/oauth2/token', { code, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
  refresh: (refreshToken) => tokenRequest('dropbox', 'https://api.dropboxapi.com/oauth2/token', { refresh_token: refreshToken, grant_type: 'refresh_token' }),
  async account(token) {
    const a = await dbxPost(token, '/users/get_current_account');
    return a.email ?? a.name?.display_name ?? null;
  },
  async list(token, { folderId, query, cursor }) {
    if (query && !cursor) {
      const data = await dbxPost(token, '/files/search_v2', { query, options: { max_results: 50 } });
      return { items: (data.matches ?? []).map((m: any) => dropboxItem(m.metadata?.metadata ?? {})).filter((i: DriveItem) => i.id), cursor: null };
    }
    const data = cursor
      ? await dbxPost(token, '/files/list_folder/continue', { cursor })
      : await dbxPost(token, '/files/list_folder', { path: folderId || '', limit: 50 });
    const items = (data.entries ?? []).map(dropboxItem).sort((a: DriveItem, b: DriveItem) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name));
    return { items, cursor: data.has_more ? data.cursor : null };
  },
  async metadata(token, id) {
    return dropboxItem(await dbxPost(token, '/files/get_metadata', { path: id }));
  },
  async download(token, item, maxBytes) {
    const res = await call('dropbox', 'https://content.dropboxapi.com/2/files/download', {
      token,
      method: 'POST',
      headers: { 'Dropbox-API-Arg': dbxArg({ path: item.id }) },
    });
    return { body: await readCapped(res, maxBytes), filename: item.name, mimeType: guessMime(item.name, res.headers.get('content-type')) };
  },
  async revoke(token) {
    await fetch(at('dropbox', `${DBX_API}/auth/token/revoke`), { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  },
};

export const DRIVES: Record<DriveProviderId, DriveAdapter> = { google, onedrive, dropbox };
