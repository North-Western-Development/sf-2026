import crypto from 'node:crypto';
import type { Browser, Page } from '@playwright/test';
import { BASE_URL, type Session } from '../ui/fixtures';

/** Authenticated JSON call as `s`. */
export async function call<T = any>(s: Session, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${s.accessToken}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

let artPage: Page | null = null;
/** Render a PNG from HTML (avatars, banners, photos) with the browser. */
export async function art(browser: Browser, html: string, width: number, height: number): Promise<Buffer> {
  if (!artPage) artPage = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  await artPage.setViewportSize({ width, height });
  await artPage.setContent(`<html><body style="margin:0;width:${width}px;height:${height}px;overflow:hidden">${html}</body></html>`);
  return artPage.screenshot({ type: 'png' });
}

const planet = (bg: string, a: string, b: string, ring = false) =>
  `<div style="width:100%;height:100%;background:${bg};display:grid;place-items:center;position:relative">
     <div style="width:58%;height:58%;border-radius:50%;background:radial-gradient(circle at 35% 30%,${a},${b} 70%);box-shadow:0 0 40px ${a}55"></div>
     ${ring ? `<div style="position:absolute;width:86%;height:22%;border:6px solid ${a}aa;border-radius:50%;transform:rotate(-18deg)"></div>` : ''}
   </div>`;

export const avatarArt = {
  nova: planet('#0b1230', '#ffe66b', '#ff8a3d'),
  ion: planet('#0b1f24', '#7df9ff', '#2a6cf0', true),
  kepler: planet('#1d0b24', '#ff8fd8', '#7b3df0'),
  lyra: planet('#0c1d12', '#a3ff8f', '#1f9e6a', true),
  orion: planet('#24130b', '#ffb07d', '#c2410c'),
  vega: planet('#101010', '#e6e6e6', '#6b7280'),
};

export const bannerArt = (a: string, b: string) =>
  `<div style="width:100%;height:100%;background:radial-gradient(60% 120% at 20% 30%,${a},transparent 60%),radial-gradient(50% 100% at 80% 70%,${b},transparent 60%),#05060c">
     ${Array.from({ length: 40 }, (_, i) => `<i style="position:absolute;left:${(i * 37) % 100}%;top:${(i * 53) % 100}%;width:2px;height:2px;background:#fff;opacity:${0.3 + ((i * 7) % 7) / 10}"></i>`).join('')}
   </div>`;

export const photoArt = (a: string, b: string, c: string) =>
  `<div style="width:100%;height:100%;background:radial-gradient(40% 50% at 30% 40%,${a},transparent 70%),radial-gradient(45% 55% at 70% 60%,${b},transparent 70%),radial-gradient(30% 30% at 55% 25%,${c},transparent 70%),#020208;filter:saturate(1.3)">
     ${Array.from({ length: 70 }, (_, i) => `<i style="position:absolute;left:${(i * 29) % 100}%;top:${(i * 61) % 100}%;width:${1 + (i % 3)}px;height:${1 + (i % 3)}px;border-radius:50%;background:#fff;opacity:${0.25 + ((i * 3) % 7) / 10}"></i>`).join('')}
   </div>`;

/** Upload an image through the media ticket flow (avatars, banners, beacon icons). */
export async function uploadMedia(s: Session, purpose: string, png: Buffer): Promise<string> {
  const ticket = await call(s, 'POST', '/media/upload-ticket', { purpose, mimeType: 'image/png', sizeBytes: png.length });
  const put = await fetch(ticket.uploadUrl, { method: ticket.method ?? 'PUT', body: png, headers: { 'Content-Type': 'image/png', ...(ticket.headers ?? {}) } });
  if (!put.ok) throw new Error(`media PUT ${put.status}`);
  const done = await call(s, 'POST', `/media/${ticket.mediaId}/complete`);
  return done.publicUrl ?? ticket.publicUrl;
}

/** Put a file in someone's vault; returns its id (for attachmentIds). */
export async function uploadVault(s: Session, filename: string, mimeType: string, body: Buffer): Promise<string> {
  await call(s, 'POST', '/vault/disclaimer/accept');
  const ticket = await call(s, 'POST', '/vault/upload-ticket', { filename, mimeType, sizeBytes: body.length });
  const put = await fetch(ticket.presignedUploadUrl, { method: 'PUT', body, headers: { 'Content-Type': mimeType } });
  if (!put.ok) throw new Error(`vault PUT ${put.status}`);
  const { file } = await call(s, 'POST', '/vault/files', { storageKey: ticket.storageKey, filename, mimeType, sizeBytes: body.length });
  return file.id;
}

/** RFC 6238 TOTP for a base32 secret (to finish 2FA setup for the 2FA screen). */
export function totp(secretBase32: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secretBase32.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = crypto.createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}
