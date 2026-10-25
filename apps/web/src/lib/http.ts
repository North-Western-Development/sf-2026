import { api } from '../services/api';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = '/api/v1';

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await api.request(`${BASE}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || data.message || res.statusText, res.status, data.code);
  return data as T;
}

/** Authenticated JSON calls against /api/v1. Paths start with '/'. */
export const http = {
  get: <T>(path: string) => send<T>('GET', path),
  post: <T>(path: string, body?: unknown) => send<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => send<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => send<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string, body?: unknown) => send<T>('DELETE', path, body),
};

/** Resolve to `fallback` when an endpoint is not available yet (404/405/501). */
export async function optional<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError && [404, 405, 501].includes(err.status)) return fallback;
    throw err;
  }
}
