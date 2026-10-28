import crypto from 'node:crypto';
import fs from 'node:fs';
import http2 from 'node:http2';

/**
 * Apple Push Notification service, spoken to directly (HTTP/2, token auth): no relay in between.
 * Configured by the instance operator with a key from their Apple Developer account:
 *   APNS_KEY_FILE (the .p8 file) or APNS_KEY (its contents), APNS_KEY_ID, APNS_TEAM_ID,
 *   APNS_TOPIC (the app's bundle id, default click.subspace.mobile), APNS_SANDBOX=true for
 *   development builds. APNS_URL overrides the host (the tests use it).
 * Without them iOS push is unavailable and the app says so.
 */

const DEFAULT_TOPIC = 'click.subspace.mobile';

function keyPem(): string | null {
  if (process.env.APNS_KEY) return process.env.APNS_KEY.replace(/\\n/g, '\n');
  if (process.env.APNS_KEY_FILE) {
    try {
      return fs.readFileSync(process.env.APNS_KEY_FILE, 'utf8');
    } catch {
      return null;
    }
  }
  return null;
}

export const apnsConfigured = () => !!(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && keyPem());

const host = () => process.env.APNS_URL || (process.env.APNS_SANDBOX === 'true' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com');

// Apple wants the provider token reused, and refreshed between 20 and 60 minutes.
let jwt: { value: string; at: number; key: string } | null = null;
function providerToken(): string {
  const keyId = process.env.APNS_KEY_ID!;
  const cacheKey = `${keyId}:${process.env.APNS_TEAM_ID}`;
  if (jwt && jwt.key === cacheKey && Date.now() - jwt.at < 45 * 60_000) return jwt.value;
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ alg: 'ES256', kid: keyId })}.${enc({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) })}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), { key: keyPem()!, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  jwt = { value: `${unsigned}.${signature}`, at: Date.now(), key: cacheKey };
  return jwt.value;
}

let session: http2.ClientHttp2Session | null = null;
function connection(): http2.ClientHttp2Session {
  if (session && !session.closed && !session.destroyed) return session;
  const s = http2.connect(host());
  s.on('error', () => {});
  s.on('close', () => session === s && (session = null));
  s.on('goaway', () => session === s && (session = null));
  // Idle connections close themselves; the next push opens a new one.
  s.setTimeout(10 * 60_000, () => s.close());
  session = s;
  return s;
}

export interface ApnsResult {
  status: number;
  reason?: string;
}

/** Send one alert. `gone` results (the token is dead) should be deleted by the caller. */
export function sendApns(deviceToken: string, payload: object): Promise<ApnsResult> {
  return new Promise((resolve) => {
    let req: http2.ClientHttp2Stream;
    try {
      req = connection().request({
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        authorization: `bearer ${providerToken()}`,
        'apns-topic': process.env.APNS_TOPIC || DEFAULT_TOPIC,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 86_400),
      });
    } catch (err) {
      return resolve({ status: 0, reason: (err as Error).message });
    }
    let status = 0;
    let body = '';
    req.setTimeout(10_000, () => req.close(http2.constants.NGHTTP2_CANCEL));
    req.on('response', (headers) => (status = Number(headers[':status']) || 0));
    req.on('data', (chunk) => body.length < 4096 && (body += chunk));
    req.on('close', () => {
      let reason: string | undefined;
      try {
        reason = body ? JSON.parse(body).reason : undefined;
      } catch {}
      resolve({ status, reason });
    });
    req.on('error', (err) => resolve({ status: 0, reason: err.message }));
    req.end(JSON.stringify(payload));
  });
}

/** Whether APNs says this token will never work again. */
export const apnsTokenGone = (r: ApnsResult) => r.status === 410 || (r.status === 400 && ['BadDeviceToken', 'DeviceTokenNotForTopic'].includes(r.reason ?? ''));

/** For tests and shutdown. */
export function closeApns() {
  session?.close();
  session = null;
  jwt = null;
}
