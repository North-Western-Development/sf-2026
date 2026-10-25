/**
 * Connections (Discord's): link another account to show it on your profile. Each provider
 * signs the user in (OAuth 2 with PKCE, or Steam's OpenID 2.0) only to learn their public
 * identity; no provider token is stored.
 *
 * Google, Microsoft and Dropbox reuse the Vault's drive credentials; GitHub needs
 * GITHUB_CLIENT_ID/SECRET; Steam needs nothing (STEAM_API_KEY, if set, adds the persona name).
 * CONNECTIONS_MOCK_ORIGIN (or DRIVE_MOCK_ORIGIN), outside production, sends every provider
 * request to a local mock so tests run the real flow.
 */

export type ConnectionProvider = 'github' | 'google' | 'microsoft' | 'dropbox' | 'steam';
export const CONNECTION_PROVIDERS: ConnectionProvider[] = ['github', 'google', 'microsoft', 'dropbox', 'steam'];

export interface Identity {
  id: string;
  name: string;
  url: string | null;
}

export class ConnectionError extends Error {}

/** Path prefix each provider has on the mock server (Microsoft shares the OneDrive mock). */
const MOCK_PREFIX: Record<ConnectionProvider, string> = { github: 'github', google: 'google', microsoft: 'onedrive', dropbox: 'dropbox', steam: 'steam' };
const mockOrigin = () =>
  process.env.NODE_ENV !== 'production' ? (process.env.CONNECTIONS_MOCK_ORIGIN || process.env.DRIVE_MOCK_ORIGIN)?.replace(/\/$/, '') : undefined;
function at(provider: ConnectionProvider, url: string) {
  const mock = mockOrigin();
  if (!mock) return url;
  const u = new URL(url);
  return `${mock}/${MOCK_PREFIX[provider]}${u.pathname}${u.search}`;
}

function credentials(provider: ConnectionProvider) {
  const env = process.env;
  const map: Record<Exclude<ConnectionProvider, 'steam'>, [string | undefined, string | undefined]> = {
    github: [env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET],
    google: [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET],
    microsoft: [env.ONEDRIVE_CLIENT_ID, env.ONEDRIVE_CLIENT_SECRET],
    dropbox: [env.DROPBOX_APP_KEY, env.DROPBOX_APP_SECRET],
  };
  if (provider === 'steam') return null;
  const [clientId, clientSecret] = map[provider];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export const isConnectionConfigured = (p: ConnectionProvider) => p === 'steam' || !!credentials(p);

const OAUTH: Record<Exclude<ConnectionProvider, 'steam'>, { authorize: string; token: string; scope: string }> = {
  github: { authorize: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token', scope: 'read:user' },
  google: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'openid profile email' },
  microsoft: { authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scope: 'User.Read' },
  dropbox: { authorize: 'https://www.dropbox.com/oauth2/authorize', token: 'https://api.dropboxapi.com/oauth2/token', scope: 'account_info.read' },
};

const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';

/** Where to send the user to sign in. */
export function authorizeUrl(provider: ConnectionProvider, p: { redirectUri: string; state: string; challenge: string; realm: string }): string {
  if (provider === 'steam') {
    // OpenID 2.0 has no state parameter: it rides on the return URL.
    const returnTo = `${p.redirectUri}?state=${encodeURIComponent(p.state)}`;
    return at(
      'steam',
      `${STEAM_OPENID}?${new URLSearchParams({
        'openid.ns': OPENID_NS,
        'openid.mode': 'checkid_setup',
        'openid.return_to': returnTo,
        'openid.realm': p.realm,
        'openid.identity': `${OPENID_NS}/identifier_select`,
        'openid.claimed_id': `${OPENID_NS}/identifier_select`,
      })}`
    );
  }
  const creds = credentials(provider)!;
  const o = OAUTH[provider];
  return at(
    provider,
    `${o.authorize}?${new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: p.redirectUri,
      response_type: 'code',
      scope: o.scope,
      state: p.state,
      code_challenge: p.challenge,
      code_challenge_method: 'S256',
      ...(provider === 'dropbox' ? { token_access_type: 'online' } : {}),
      ...(provider === 'google' ? { prompt: 'select_account' } : {}),
    })}`
  );
}

async function getJson(provider: ConnectionProvider, url: string, init: RequestInit = {}) {
  const res = await fetch(at(provider, url), { ...init, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new ConnectionError(`${provider} returned ${res.status}`);
  return res.json() as Promise<any>;
}

/** Finish an OAuth sign-in and read who signed in. */
export async function oauthIdentity(provider: Exclude<ConnectionProvider, 'steam'>, code: string, redirectUri: string, verifier: string): Promise<Identity> {
  const creds = credentials(provider);
  if (!creds) throw new ConnectionError('not configured');
  const tokens = await getJson(provider, OAUTH[provider].token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, code, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
  });
  const token = tokens.access_token as string | undefined;
  if (!token) throw new ConnectionError('no access token');
  const auth = { Authorization: `Bearer ${token}` };
  switch (provider) {
    case 'github': {
      const u = await getJson('github', 'https://api.github.com/user', { headers: { ...auth, Accept: 'application/vnd.github+json', 'User-Agent': 'Subspace' } });
      return { id: String(u.id), name: u.login, url: u.html_url ?? `https://github.com/${u.login}` };
    }
    case 'google': {
      const u = await getJson('google', 'https://openidconnect.googleapis.com/v1/userinfo', { headers: auth });
      return { id: String(u.sub ?? u.email), name: u.name || u.email, url: null };
    }
    case 'microsoft': {
      const u = await getJson('microsoft', 'https://graph.microsoft.com/v1.0/me', { headers: auth });
      return { id: String(u.id ?? u.mail ?? u.userPrincipalName), name: u.displayName || u.mail || u.userPrincipalName, url: null };
    }
    case 'dropbox': {
      const u = await getJson('dropbox', 'https://api.dropboxapi.com/2/users/get_current_account', { method: 'POST', headers: auth });
      return { id: String(u.account_id ?? u.email), name: u.name?.display_name || u.email, url: null };
    }
  }
}

/** Check a Steam OpenID response with Steam itself, then read the Steam ID it vouches for. */
export async function steamIdentity(params: Record<string, string>, expectedReturnTo: string): Promise<Identity> {
  if (params['openid.mode'] !== 'id_res') throw new ConnectionError('not signed in');
  if (!params['openid.return_to']?.startsWith(expectedReturnTo)) throw new ConnectionError('return_to mismatch');
  const claimed = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(params['openid.claimed_id'] ?? '');
  if (!claimed) throw new ConnectionError('bad claimed id');
  const verify = new URLSearchParams(Object.entries(params).filter(([k]) => k.startsWith('openid.')));
  verify.set('openid.mode', 'check_authentication');
  const res = await fetch(at('steam', STEAM_OPENID), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: verify,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok || !/is_valid\s*:\s*true/.test(await res.text())) throw new ConnectionError('Steam did not confirm the sign-in');
  const steamId = claimed[1];
  let name = steamId;
  if (process.env.STEAM_API_KEY) {
    const data = await getJson('steam', `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${process.env.STEAM_API_KEY}&steamids=${steamId}`).catch(() => null);
    name = data?.response?.players?.[0]?.personaname || steamId;
  }
  return { id: steamId, name, url: `https://steamcommunity.com/profiles/${steamId}` };
}
