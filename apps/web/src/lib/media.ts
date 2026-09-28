import { http } from './http';

export type MediaPurpose = 'avatar' | 'banner' | 'beacon_icon' | 'beacon_banner' | 'glyph' | 'mesh_icon';

export const MEDIA_LIMITS: Record<MediaPurpose, number> = {
  avatar: 8 * 1024 ** 2,
  banner: 10 * 1024 ** 2,
  beacon_icon: 8 * 1024 ** 2,
  beacon_banner: 10 * 1024 ** 2,
  glyph: 256 * 1024,
  mesh_icon: 8 * 1024 ** 2,
};

export const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** Upload an image through the media ticket flow; resolves to its verified public URL. */
export async function uploadMedia(purpose: MediaPurpose, file: File): Promise<string> {
  if (!MEDIA_TYPES.includes(file.type)) throw new Error('Use a PNG, JPEG, GIF or WebP image.');
  if (file.size > MEDIA_LIMITS[purpose]) throw new Error(`That image is too large (max ${Math.round(MEDIA_LIMITS[purpose] / 1024 / 1024) || 0.25} MB).`);
  const ticket = await http.post<{ uploadUrl: string; method?: string; headers?: Record<string, string>; mediaId: string; publicUrl: string }>(
    '/media/upload-ticket',
    { purpose, mimeType: file.type, sizeBytes: file.size }
  );
  const put = await fetch(ticket.uploadUrl, { method: ticket.method ?? 'PUT', body: file, headers: { 'Content-Type': file.type, ...(ticket.headers ?? {}) } });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  const done = await http.post<{ publicUrl: string }>(`/media/${ticket.mediaId}/complete`);
  return done.publicUrl ?? ticket.publicUrl;
}

/** Let the user pick an image file. */
export function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = MEDIA_TYPES.join(',');
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
