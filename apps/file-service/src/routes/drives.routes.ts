import crypto from 'node:crypto';
import { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify';
import { and, eq, driveConnections, transmitters, vaultFiles } from '@subspace/database';
import { getJwtSecret } from '@subspace/crypto';
import { SubspaceS3Storage } from '../s3.js';
import { DRIVES, DRIVE_PROVIDERS, DriveError, isDriveConfigured, type DriveAdapter, type DriveProviderId } from '../integrations/drives.js';
import { extractAuthToken, MAX_FILE_SIZE_BYTES, DEFAULT_USER_QUOTA_BYTES, vaultBytesUsed } from './vault.routes.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const COOKIE = 'subspace_drive_oauth';
const COOKIE_PATH = '/api/v1/vault/drives';
const DISCLAIMER =
  'Files uploaded to Subspace Frequency are accessible to anyone with the direct link (with or without an account). Instance staff will always have access to review all files. Do not upload sensitive, confidential, or private material.';

// --- Sealed values (OAuth state and stored tokens) -------------------------------------

const key = () => crypto.createHash('sha256').update(`drive-tokens:${process.env.DRIVE_TOKEN_KEY || getJwtSecret()}`).digest();

export function seal(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}

export function unseal<T>(sealed: string): T | null {
  try {
    const raw = Buffer.from(sealed, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')) as T;
  } catch {
    return null;
  }
}

interface OAuthState {
  t: string; // transmitter
  p: DriveProviderId;
  v: string; // PKCE verifier
  n: string; // nonce, also in the HttpOnly cookie of the browser that started the flow
  r: string; // redirect URI
  e: number; // expiry (ms)
}

const cookieValue = (header: string | undefined, name: string) =>
  header
    ?.split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === name)?.[1];

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The page the OAuth popup lands on: tells the opener and closes itself. */
function popupPage(reply: FastifyReply, ok: boolean, message: string, provider?: string) {
  const payload = JSON.stringify({ type: 'subspace-drive', provider: provider ?? null, ok, message }).replace(/</g, '\\u003c');
  return reply
    .header('Content-Type', 'text/html; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .header('Set-Cookie', `${COOKIE}=; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0`)
    .status(ok ? 200 : 400)
    .send(
      `<!doctype html><meta charset="utf-8"><title>Subspace Vault</title>` +
        `<body style="background:#07080c;color:#eef1fa;font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0">` +
        `<p>${escapeHtml(message)}</p>` +
        `<script>try{window.opener&&window.opener.postMessage(${payload},location.origin)}catch(e){}setTimeout(function(){window.close()},${ok ? 300 : 4000})</script>`
    );
}

const providerParam = {
  type: 'object',
  required: ['provider'],
  properties: { provider: { type: 'string', enum: DRIVE_PROVIDERS } },
};

export const driveRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = (app as any).db;
  const s3: SubspaceS3Storage = (app as any).s3;

  async function connection(transmitterId: string, provider: DriveProviderId) {
    const [row] = await db
      .select()
      .from(driveConnections)
      .where(and(eq(driveConnections.transmitterId, transmitterId), eq(driveConnections.provider, provider)))
      .limit(1);
    return row ?? null;
  }

  async function saveTokens(transmitterId: string, provider: DriveProviderId, tokens: { accessToken: string; refreshToken?: string | null; expiresAt?: Date | null }, accountLabel?: string | null) {
    const values = {
      accessToken: seal(tokens.accessToken),
      expiresAt: tokens.expiresAt ?? null,
      ...(tokens.refreshToken ? { refreshToken: seal(tokens.refreshToken) } : {}),
      ...(accountLabel !== undefined ? { accountLabel } : {}),
    };
    await db
      .insert(driveConnections)
      .values({ transmitterId, provider, ...values })
      .onConflictDoUpdate({ target: [driveConnections.transmitterId, driveConnections.provider], set: values });
  }

  /** Run a drive call with a fresh access token, refreshing once if the drive says it expired. */
  async function withToken<T>(transmitterId: string, adapter: DriveAdapter, fn: (token: string) => Promise<T>): Promise<T> {
    const row = await connection(transmitterId, adapter.id);
    if (!row) throw new DriveError(`${adapter.name} is not connected.`, 409, 'DRIVE_NOT_CONNECTED');
    let token = unseal<string>(row.accessToken);
    const refreshToken = row.refreshToken ? unseal<string>(row.refreshToken) : null;
    const refresh = async () => {
      if (!refreshToken) throw new DriveError('The drive connection has expired. Connect it again.', 401, 'DRIVE_UNAUTHORIZED');
      const fresh = await adapter.refresh(refreshToken);
      await saveTokens(transmitterId, adapter.id, fresh);
      return fresh.accessToken;
    };
    if (!token || (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now() + 60_000)) token = await refresh();
    try {
      return await fn(token);
    } catch (err) {
      if (err instanceof DriveError && err.code === 'DRIVE_UNAUTHORIZED' && refreshToken) return fn(await refresh());
      throw err;
    }
  }

  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof DriveError) return reply.status(err.status).send({ error: err.message, code: err.code });
    app.log.warn({ err: (err as Error).message }, '[Drives] request failed');
    return reply.status(502).send({ error: 'The drive could not be reached. Try again.', code: 'DRIVE_UNREACHABLE' });
  };

  /**
   * GET /api/v1/vault/drives
   * Each provider: whether this instance has it configured and whether the caller connected it.
   */
  app.get('/', async (request, reply) => {
    const token = extractAuthToken(request)!;
    if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
    const rows = await db.select().from(driveConnections).where(eq(driveConnections.transmitterId, token.transmitterId));
    return reply.send({
      drives: DRIVE_PROVIDERS.map((p) => {
        const row = rows.find((r: any) => r.provider === p);
        return { provider: p, name: DRIVES[p].name, configured: isDriveConfigured(p), connected: !!row, accountLabel: row?.accountLabel ?? null };
      }),
    });
  });

  /**
   * POST /api/v1/vault/drives/:provider/connect
   * Starts OAuth: returns the provider's consent URL for a popup, and binds the flow to this
   * browser with an HttpOnly cookie so a consent link cannot be replayed into another account.
   */
  app.post('/:provider/connect', { schema: { params: providerParam } }, async (request, reply) => {
    const token = extractAuthToken(request)!;
    const { provider } = request.params as { provider: DriveProviderId };
    if (!isDriveConfigured(provider)) return reply.status(400).send({ error: `${DRIVES[provider].name} is not configured on this instance.`, code: 'DRIVE_NOT_CONFIGURED' });
    // Return to the origin the user is on (dev, test and production differ); providers only
    // accept redirect URIs registered for the app, so a forged Origin goes nowhere.
    const base = (process.env.DRIVE_REDIRECT_BASE || String(request.headers.origin || '') || process.env.PUBLIC_ORIGIN || '').replace(/\/$/, '');
    if (!/^https?:\/\/[^/]+$/.test(base)) return reply.status(400).send({ error: 'Could not work out this site’s address for the sign-in redirect.', code: 'NO_REDIRECT_BASE' });
    const verifier = crypto.randomBytes(32).toString('base64url');
    const nonce = crypto.randomBytes(16).toString('base64url');
    const redirectUri = `${base}${COOKIE_PATH}/${provider}/callback`;
    const state = seal({ t: token.transmitterId, p: provider, v: verifier, n: nonce, r: redirectUri, e: Date.now() + STATE_TTL_MS } satisfies OAuthState);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const secure = base.startsWith('https:') ? '; Secure' : '';
    reply.header('Set-Cookie', `${COOKIE}=${nonce}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=600${secure}`);
    return reply.send({ url: DRIVES[provider].authorizeUrl({ redirectUri, state, challenge }), redirectUri });
  });

  /**
   * GET /api/v1/vault/drives/:provider/callback
   * The provider redirects the popup here. Public because it is a top-level navigation with no
   * bearer token: the sealed state names the account and the cookie proves the same browser.
   */
  app.get(
    '/:provider/callback',
    {
      config: { public: true },
      schema: {
        params: providerParam,
        querystring: { type: 'object', properties: { code: { type: 'string', maxLength: 4096 }, state: { type: 'string', maxLength: 4096 }, error: { type: 'string', maxLength: 200 } } },
      },
    },
    async (request, reply) => {
      const { provider } = request.params as { provider: DriveProviderId };
      const { code, state, error } = request.query as { code?: string; state?: string; error?: string };
      const adapter = DRIVES[provider];
      if (error) return popupPage(reply, false, `${adapter.name} was not connected.`, provider);
      const st = state ? unseal<OAuthState>(state) : null;
      const nonce = cookieValue(request.headers.cookie, COOKIE);
      if (!st || !code || st.p !== provider || st.e < Date.now() || !nonce || nonce.length !== st.n.length || !crypto.timingSafeEqual(Buffer.from(nonce), Buffer.from(st.n))) {
        return popupPage(reply, false, 'This sign-in link is invalid or has expired. Start again from the Vault.', provider);
      }
      if (!db) return popupPage(reply, false, 'The Vault is unavailable right now.', provider);
      try {
        const tokens = await adapter.exchange(code, st.r, st.v);
        const label = await adapter.account(tokens.accessToken).catch(() => null);
        await saveTokens(st.t, provider, tokens, label);
        return popupPage(reply, true, `${adapter.name} connected. You can close this window.`, provider);
      } catch (err) {
        app.log.warn({ err: (err as Error).message, cause: String((err as any).cause ?? ''), provider }, '[Drives] OAuth exchange failed');
        return popupPage(reply, false, `${adapter.name} could not be connected. Try again.`, provider);
      }
    }
  );

  /**
   * DELETE /api/v1/vault/drives/:provider
   * Disconnect: revoke at the provider where it supports that, then forget the tokens.
   */
  app.delete('/:provider', { schema: { params: providerParam } }, async (request, reply) => {
    const token = extractAuthToken(request)!;
    const { provider } = request.params as { provider: DriveProviderId };
    const row = await connection(token.transmitterId, provider);
    if (row) {
      const access = unseal<string>(row.accessToken);
      if (access) await DRIVES[provider].revoke(access).catch(() => {});
      await db.delete(driveConnections).where(and(eq(driveConnections.transmitterId, token.transmitterId), eq(driveConnections.provider, provider)));
    }
    return reply.status(204).send();
  });

  /**
   * GET /api/v1/vault/drives/:provider/files?folderId=&q=&cursor=
   */
  app.get(
    '/:provider/files',
    {
      schema: {
        params: providerParam,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { folderId: { type: 'string', maxLength: 512 }, q: { type: 'string', maxLength: 200 }, cursor: { type: 'string', maxLength: 4096 } },
        },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request)!;
      const { provider } = request.params as { provider: DriveProviderId };
      const { folderId, q, cursor } = request.query as { folderId?: string; q?: string; cursor?: string };
      try {
        const listing = await withToken(token.transmitterId, DRIVES[provider], (t) => DRIVES[provider].list(t, { folderId, query: q?.trim() || undefined, cursor }));
        return reply.send(listing);
      } catch (err) {
        return fail(reply, err);
      }
    }
  );

  /**
   * POST /api/v1/vault/drives/:provider/import  { fileId }
   * Copies one file from the drive into the caller's vault, under the same rules as an upload:
   * the disclaimer gate, the 50 MB limit and the personal quota.
   */
  app.post(
    '/:provider/import',
    {
      schema: {
        params: providerParam,
        body: { type: 'object', additionalProperties: false, required: ['fileId'], properties: { fileId: { type: 'string', minLength: 1, maxLength: 512 } } },
      },
    },
    async (request, reply) => {
      const token = extractAuthToken(request)!;
      if (!db) return reply.status(503).send({ error: 'Database service unavailable' });
      const { provider } = request.params as { provider: DriveProviderId };
      const { fileId } = request.body as { fileId: string };
      const [me] = await db.select({ accepted: transmitters.hasAcceptedUploadDisclaimer }).from(transmitters).where(eq(transmitters.id, token.transmitterId)).limit(1);
      if (!me?.accepted) {
        return reply.status(403).send({ error: 'First-time upload disclaimer required', code: 'DISCLAIMER_REQUIRED', disclaimerNotice: DISCLAIMER });
      }
      const adapter = DRIVES[provider];
      try {
        const used = await vaultBytesUsed(db, token.transmitterId);
        const download = await withToken(token.transmitterId, adapter, async (t) => {
          const item = await adapter.metadata(t, fileId);
          if (!item.importable) throw new DriveError(item.isFolder ? 'Folders cannot be imported; open it and pick files.' : 'That item cannot be imported.', 400, 'NOT_IMPORTABLE');
          if (item.size !== undefined && item.size > MAX_FILE_SIZE_BYTES) throw new DriveError('File is larger than the 50 MB upload limit.', 400, 'FILE_TOO_LARGE');
          if (item.size !== undefined && used + item.size > DEFAULT_USER_QUOTA_BYTES) throw new DriveError('Subspace Vault storage quota exceeded', 403, 'STORAGE_QUOTA_EXCEEDED');
          return adapter.download(t, item, MAX_FILE_SIZE_BYTES);
        });
        if (!download.body.length) throw new DriveError('That file is empty.', 400, 'EMPTY_FILE');
        if (used + download.body.length > DEFAULT_USER_QUOTA_BYTES) throw new DriveError('Subspace Vault storage quota exceeded', 403, 'STORAGE_QUOTA_EXCEEDED');

        const filename = download.filename.trim().slice(0, 255) || 'file';
        const storageKey = `vaults/${token.transmitterId}/${crypto.randomUUID()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        await s3.putObject(storageKey, download.body, download.mimeType);
        const [file] = await db
          .insert(vaultFiles)
          .values({ transmitterId: token.transmitterId, storageKey, filename, mimeType: download.mimeType, sizeBytes: BigInt(download.body.length) })
          .returning();
        return reply.status(201).send({ file: { ...file, sizeBytes: file.sizeBytes.toString(), source: provider } });
      } catch (err) {
        return fail(reply, err);
      }
    }
  );
};
