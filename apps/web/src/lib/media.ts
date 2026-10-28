import { http } from './http';

export type MediaPurpose = 'avatar' | 'banner' | 'beacon_icon' | 'beacon_banner' | 'glyph' | 'mesh_icon' | 'sticker' | 'sound' | 'badge' | 'app_icon';

export const MEDIA_LIMITS: Record<MediaPurpose, number> = {
  avatar: 8 * 1024 ** 2,
  banner: 10 * 1024 ** 2,
  beacon_icon: 8 * 1024 ** 2,
  beacon_banner: 10 * 1024 ** 2,
  glyph: 256 * 1024,
  mesh_icon: 8 * 1024 ** 2,
  sticker: 512 * 1024,
  sound: 512 * 1024,
  badge: 256 * 1024,
  app_icon: 4 * 1024 ** 2,
};

export const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const AUDIO_TYPES = ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm'];

/** Upload an image (or, for sounds, audio) through the media ticket flow; resolves to its verified public URL. */
export async function uploadMedia(purpose: MediaPurpose, file: File): Promise<string> {
  const audio = purpose === 'sound';
  if (!(audio ? AUDIO_TYPES : MEDIA_TYPES).includes(file.type)) throw new Error(audio ? 'Use an MP3, OGG, WAV or WebM sound.' : 'Use a PNG, JPEG, GIF or WebP image.');
  const limit = MEDIA_LIMITS[purpose];
  if (file.size > limit) throw new Error(`That file is too large (max ${limit >= 1024 ** 2 ? `${Math.round(limit / 1024 ** 2)} MB` : `${Math.round(limit / 1024)} KB`}).`);
  const ticket = await http.post<{ uploadUrl: string; method?: string; headers?: Record<string, string>; mediaId: string; publicUrl: string }>(
    '/media/upload-ticket',
    { purpose, mimeType: file.type, sizeBytes: file.size }
  );
  const put = await fetch(ticket.uploadUrl, { method: ticket.method ?? 'PUT', body: file, headers: { 'Content-Type': file.type, ...(ticket.headers ?? {}) } });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  const done = await http.post<{ publicUrl: string }>(`/media/${ticket.mediaId}/complete`);
  return done.publicUrl ?? ticket.publicUrl;
}

function pick(accept: string[]): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept.join(',');
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** Let the user pick an image file. */
export const pickImage = () => pick(MEDIA_TYPES);

/** Let the user pick a sound file. */
export const pickAudio = () => pick(AUDIO_TYPES);
