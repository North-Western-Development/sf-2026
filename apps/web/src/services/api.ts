// Real Subspace Frequency API Service Client

const API_BASE = '/api/v1';

export interface TransmitterProfile {
  id: string;
  username: string;
  discriminator?: string;
  email?: string;
  displayName?: string;
  displayColor?: string;
  displayFont?: string;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  bannerColor?: string | null;
  presence?: string;
  staffRank?: number;
  roles?: string[];
  bio?: string;
}

export interface ApiBeacon {
  id: string;
  name: string;
  description?: string | null;
  iconUrl?: string | null;
  bannerUrl?: string | null;
  ownerId?: string;
  isDiscoverable?: boolean;
}

export interface ApiRelay {
  id: string;
  beaconId: string;
  parentId?: string | null;
  name: string;
  type: 'text' | 'voice' | 'announcement' | 'archive' | 'archival' | 'gallery' | 'visual';
  topic?: string | null;
  position: number;
  isUnhideable?: boolean;
  isHidden?: boolean;
}

export interface ApiCluster {
  id: string;
  transmitterId?: string;
  name: string;
  color?: string;
  position?: number;
  beaconIds: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ApiTransmission {
  id: string;
  relayId: string;
  threadId?: string | null;
  authorId: string;
  content: string;
  isPinned?: boolean;
  createdAt: string;
  updatedAt?: string;
  author?: {
    id: string;
    username: string;
    discriminator?: string;
    displayName?: string;
    displayColor?: string;
    avatarUrl?: string | null;
    staffRank?: number;
  };
}

export interface ApiMember {
  transmitterId: string;
  username: string;
  discriminator?: string;
  displayName: string;
  displayColor?: string;
  displayFont?: string;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  bannerColor?: string | null;
  bio?: string;
  presence?: string;
  hasCompletedOnboarding?: boolean;
  clearanceIds?: string[];
  isOwner?: boolean;
  staffRank?: number;
  roles?: string[];
}

export class AuthRequiredError extends Error {
  constructor() {
    super('Authentication required');
    this.name = 'AuthRequiredError';
  }
}

export type LoginResult =
  | { kind: 'session'; transmitter: TransmitterProfile; requiresRulesAgreement: boolean }
  | { kind: '2fa'; challengeToken: string };

type SessionListener = (transmitter: TransmitterProfile | null) => void;

const STORAGE = {
  access: 'subspace_access_token',
  refresh: 'subspace_refresh_token',
  user: 'subspace_user',
} as const;

const decodeExp = (jwt: string): number => {
  try {
    const body = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(body)).exp ?? 0;
  } catch {
    return 0;
  }
};

const readStorage = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

class SubspaceApiClient {
  private token: string | null = null;
  private refreshToken: string | null = null;
  private transmitter: TransmitterProfile | null = null;
  private refreshInFlight: Promise<boolean> | null = null;
  private listeners = new Set<SessionListener>();

  constructor() {
    this.token = readStorage(STORAGE.access);
    this.refreshToken = readStorage(STORAGE.refresh);
    const storedUser = readStorage(STORAGE.user);
    if (storedUser) {
      try {
        this.transmitter = JSON.parse(storedUser);
      } catch {
        this.transmitter = null;
      }
    }
  }

  public getToken(): string | null {
    return this.token;
  }

  public getTransmitter(): TransmitterProfile | null {
    return this.transmitter;
  }

  public hasSession(): boolean {
    return !!(this.token || this.refreshToken) && !!this.transmitter;
  }

  /** Subscribe to sign-in / sign-out. Returns an unsubscribe function. */
  public onSessionChange(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setSession(data: { accessToken: string; refreshToken?: string; transmitter?: TransmitterProfile }) {
    this.token = data.accessToken;
    if (data.refreshToken) this.refreshToken = data.refreshToken;
    if (data.transmitter) this.transmitter = data.transmitter;
    try {
      localStorage.setItem(STORAGE.access, this.token);
      if (this.refreshToken) localStorage.setItem(STORAGE.refresh, this.refreshToken);
      if (this.transmitter) localStorage.setItem(STORAGE.user, JSON.stringify(this.transmitter));
    } catch {
      /* storage unavailable: session lives in memory only */
    }
    this.listeners.forEach((l) => l(this.transmitter));
  }

  private clearSession() {
    this.token = null;
    this.refreshToken = null;
    this.transmitter = null;
    try {
      Object.values(STORAGE).forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
    this.listeners.forEach((l) => l(null));
  }

  private async postJson(url: string, body: unknown) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || data.message || 'Request failed') as Error & {
        code?: string;
        status?: number;
      };
      err.code = data.code;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** identifier: username#0000, email, or a username that is unique on this instance. */
  public async login(identifier: string, password: string, opts: { reactivate?: boolean } = {}): Promise<LoginResult> {
    const data = await this.postJson(`${API_BASE}/auth/login`, { username: identifier, password, ...(opts.reactivate ? { reactivate: true } : {}) });
    if (data.requires2FA) return { kind: '2fa', challengeToken: data.tempToken };
    this.setSession(data);
    return { kind: 'session', transmitter: data.transmitter, requiresRulesAgreement: !!data.requiresRulesAgreement };
  }

  /** Passwordless sign-in: the browser asks for any passkey saved for this site. */
  public async loginWithPasskey(opts: { reactivate?: boolean } = {}): Promise<LoginResult> {
    const { options, challengeId } = await this.postJson(`${API_BASE}/auth/passkeys/login/options`, {});
    const { startAuthentication } = await import('@simplewebauthn/browser');
    const response = await startAuthentication({ optionsJSON: options });
    const data = await this.postJson(`${API_BASE}/auth/passkeys/login/verify`, { challengeId, response, ...(opts.reactivate ? { reactivate: true } : {}) });
    this.setSession(data);
    return { kind: 'session', transmitter: data.transmitter, requiresRulesAgreement: !!data.requiresRulesAgreement };
  }

  public async completeTwoFactor(challengeToken: string, code: string, isBackupCode = false): Promise<LoginResult> {
    const data = await this.postJson(`${API_BASE}/auth/2fa/verify`, { token: challengeToken, code, isBackupCode });
    this.setSession(data);
    return { kind: 'session', transmitter: data.transmitter, requiresRulesAgreement: !!data.requiresRulesAgreement };
  }

  public async register(input: {
    username: string;
    email: string;
    password: string;
    displayName?: string;
    acceptDirectives: boolean;
  }): Promise<LoginResult> {
    const data = await this.postJson(`${API_BASE}/auth/register`, input);
    this.setSession(data);
    return { kind: 'session', transmitter: data.transmitter, requiresRulesAgreement: !!data.requiresRulesAgreement };
  }

  public async acceptDirectives(): Promise<void> {
    const res = await this.fetchAuth(`${API_BASE}/auth/directives/accept`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to record directive acceptance');
  }

  /** Re-reads the signed-in transmitter; resolves null when there is no valid session. */
  public async restoreSession(): Promise<{ transmitter: TransmitterProfile; requiresRulesAgreement: boolean } | null> {
    if (!this.token && !this.refreshToken) return null;
    try {
      const res = await this.fetchAuth(`${API_BASE}/auth/me`);
      if (!res.ok) return null;
      const data = await res.json();
      this.setSession({ accessToken: this.token!, transmitter: data.transmitter });
      return { transmitter: data.transmitter, requiresRulesAgreement: !!data.requiresRulesAgreement };
    } catch {
      return null;
    }
  }

  public async logout(): Promise<void> {
    const refreshToken = this.refreshToken;
    this.clearSession();
    if (refreshToken) {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => {});
    }
  }

  /** Exchange the refresh token once, sharing the attempt between concurrent callers. */
  private refreshSession(): Promise<boolean> {
    if (!this.refreshToken) return Promise.resolve(false);
    if (!this.refreshInFlight) {
      const refreshToken = this.refreshToken;
      this.refreshInFlight = this.postJson(`${API_BASE}/auth/refresh`, { refreshToken })
        .then((data) => {
          this.setSession(data);
          return true;
        })
        .catch(() => false)
        .finally(() => {
          this.refreshInFlight = null;
        });
    }
    return this.refreshInFlight;
  }

  /** Access token that is valid for at least another 30 seconds, refreshing if needed. */
  public async getValidToken(): Promise<string | null> {
    const exp = this.token ? decodeExp(this.token) : 0;
    if (this.token && exp * 1000 - Date.now() > 30_000) return this.token;
    return (await this.refreshSession()) ? this.token : null;
  }

  public async ensureAuthenticated(): Promise<TransmitterProfile> {
    if (this.transmitter && (this.token || (await this.refreshSession()))) return this.transmitter;
    throw new AuthRequiredError();
  }

  /** Authenticated fetch. Refreshes once on 401; signs out if that fails. */
  public async request(url: string, options: RequestInit = {}): Promise<Response> {
    return this.fetchAuth(url, options);
  }

  private async fetchAuth(url: string, options: RequestInit = {}): Promise<Response> {
    await this.ensureAuthenticated();
    // Only a JSON body gets the JSON content type: Fastify rejects an empty body declared as JSON,
    // which broke every DELETE.
    const isJson = typeof options.body === 'string';
    const build = () => ({
      ...(isJson ? { 'Content-Type': 'application/json' } : {}),
      ...((options.headers as Record<string, string>) || {}),
      Authorization: `Bearer ${this.token}`,
    });

    let res = await fetch(url, { ...options, headers: build() });
    if (res.status === 401) {
      if (await this.refreshSession()) {
        res = await fetch(url, { ...options, headers: build() });
      }
      if (res.status === 401) {
        this.clearSession();
        throw new AuthRequiredError();
      }
    }
    return res;
  }

  public async getJoinedBeacons(): Promise<ApiBeacon[]> {
    const res = await this.fetchAuth(`${API_BASE}/beacons/me`);
    if (!res.ok) throw new Error('Failed to fetch joined beacons');
    const data = await res.json();
    return data.beacons || [];
  }

  public async getDiscoverableBeacons(): Promise<ApiBeacon[]> {
    const res = await this.fetchAuth(`${API_BASE}/beacons/discovery`);
    if (!res.ok) throw new Error('Failed to fetch discoverable beacons');
    const data = await res.json();
    return data.beacons || [];
  }

  public async getBeaconRelays(beaconId: string): Promise<ApiRelay[]> {
    const res = await this.fetchAuth(`${API_BASE}/beacons/${beaconId}/relays?filter=all`);
    if (!res.ok) throw new Error(`Failed to fetch relays for beacon ${beaconId}`);
    const data = await res.json();
    return data.relays || [];
  }

  public async getBeaconMembers(beaconId: string): Promise<ApiMember[]> {
    const res = await this.fetchAuth(`${API_BASE}/beacons/${beaconId}/members`);
    if (!res.ok) throw new Error(`Failed to fetch members for beacon ${beaconId}`);
    const data = await res.json();
    return data.members || [];
  }

  public async getTransmissions(relayId: string, limit = 50): Promise<ApiTransmission[]> {
    const res = await this.fetchAuth(`${API_BASE}/relays/${relayId}/transmissions?limit=${limit}`);
    if (!res.ok) throw new Error(`Failed to fetch transmissions for relay ${relayId}`);
    const data = await res.json();
    return data.transmissions || [];
  }

  public async sendTransmission(relayId: string, content: string): Promise<ApiTransmission> {
    const res = await this.fetchAuth(`${API_BASE}/relays/${relayId}/transmissions`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error(`Failed to send transmission to relay ${relayId}`);
    const data = await res.json();
    return data.transmission;
  }

  public async updateTransmission(transmissionId: string, content: string): Promise<ApiTransmission> {
    const res = await this.fetchAuth(`${API_BASE}/transmissions/${transmissionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error(`Failed to edit transmission`);
    const data = await res.json();
    return data.transmission;
  }

  public async deleteTransmission(transmissionId: string): Promise<void> {
    const res = await this.fetchAuth(`${API_BASE}/transmissions/${transmissionId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Failed to delete transmission`);
  }

  public async editTransmission(transmissionId: string, content: string): Promise<any> {
    const res = await this.fetchAuth(`${API_BASE}/transmissions/${transmissionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Edit failed' }));
      throw new Error(err.error || 'Failed to edit transmission');
    }
    return res.json();
  }

  public async updateBeacon(beaconId: string, updates: Record<string, any>): Promise<void> {
    const res = await this.fetchAuth(`${API_BASE}/beacons/${beaconId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`Failed to update beacon`);
  }

  public async updateClearance(beaconId: string, clearanceId: string, updates: Record<string, any>): Promise<void> {
    const res = await this.fetchAuth(`${API_BASE}/beacons/${beaconId}/clearances/${clearanceId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`Failed to update clearance`);
  }

  public async createBeacon(name: string, description?: string): Promise<ApiBeacon> {
    const res = await this.fetchAuth(`${API_BASE}/beacons`, {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
    if (!res.ok) throw new Error('Failed to create beacon');
    const data = await res.json();
    return data.beacon;
  }

  public async createRelay(beaconId: string, name: string, type: string, parentId?: string, topic?: string): Promise<ApiRelay> {
    const res = await this.fetchAuth(`${API_BASE}/beacons/${beaconId}/relays`, {
      method: 'POST',
      body: JSON.stringify({ name, type, parentId, topic }),
    });
    if (!res.ok) throw new Error('Failed to create relay');
    const data = await res.json();
    return data.relay;
  }

  public async updateRelay(beaconId: string, relayId: string, updates: Record<string, any>): Promise<ApiRelay> {
    const res = await this.fetchAuth(`${API_BASE}/beacons/${beaconId}/relays/${relayId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error('Failed to update relay');
    const data = await res.json();
    return data.relay;
  }

  public async toggleRelayVisibility(beaconId: string, relayId: string, isHidden: boolean): Promise<void> {
    const res = await this.fetchAuth(`${API_BASE}/beacons/${beaconId}/relays/${relayId}/visibility`, {
      method: 'PATCH',
      body: JSON.stringify({ isHidden }),
    });
    if (!res.ok) throw new Error('Failed to update relay visibility');
  }

  public async deleteRelay(beaconId: string, relayId: string): Promise<void> {
    const res = await this.fetchAuth(`${API_BASE}/beacons/${beaconId}/relays/${relayId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete relay');
  }

  public async getClusters(): Promise<ApiCluster[]> {
    const res = await this.fetchAuth(`${API_BASE}/clusters`);
    if (!res.ok) throw new Error('Failed to fetch clusters');
    const data = await res.json();
    return data.clusters || [];
  }

  public async createCluster(name: string, color = '#00F0FF', position = 0, beaconIds: string[] = []): Promise<ApiCluster> {
    const res = await this.fetchAuth(`${API_BASE}/clusters`, {
      method: 'POST',
      body: JSON.stringify({ name, color, position, beaconIds }),
    });
    if (!res.ok) throw new Error('Failed to create cluster');
    const data = await res.json();
    return data.cluster;
  }

  public async updateCluster(clusterId: string, updates: { name?: string; color?: string; position?: number; beaconIds?: string[] }): Promise<ApiCluster> {
    const res = await this.fetchAuth(`${API_BASE}/clusters/${clusterId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error('Failed to update cluster');
    const data = await res.json();
    return data.cluster;
  }

  public async deleteCluster(clusterId: string): Promise<void> {
    const res = await this.fetchAuth(`${API_BASE}/clusters/${clusterId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete cluster');
  }

  public async updateProfile(profileData: {
    displayName?: string;
    bio?: string;
    displayColor?: string;
    displayFont?: string;
    username?: string;
    avatarUrl?: string;
  }): Promise<TransmitterProfile> {
    const res = await this.fetchAuth(`${API_BASE}/auth/me/profile`, {
      method: 'PATCH',
      body: JSON.stringify(profileData),
    });
    if (!res.ok) throw new Error('Failed to update profile');
    const data = await res.json();
    this.transmitter = data.transmitter;
    localStorage.setItem('subspace_user', JSON.stringify(data.transmitter));
    return data.transmitter;
  }

  public async getBeaconEmojis(beaconId: string): Promise<any[]> {
    const res = await this.fetchAuth(`${API_BASE}/beacons/${beaconId}/emojis`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.emojis || [];
  }

  public async uploadBeaconEmoji(beaconId: string, name: string, url: string): Promise<any> {
    const res = await this.fetchAuth(`${API_BASE}/beacons/${beaconId}/emojis`, {
      method: 'POST',
      body: JSON.stringify({ name, url }),
    });
    if (!res.ok) throw new Error('Failed to upload emoji');
    const data = await res.json();
    return data.emoji;
  }

  public async renameBeaconEmoji(beaconId: string, emojiId: string, name: string): Promise<any> {
    const res = await this.fetchAuth(`${API_BASE}/beacons/${beaconId}/emojis/${emojiId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error('Failed to rename emoji');
    const data = await res.json();
    return data.emoji;
  }

  public async deleteBeaconEmoji(beaconId: string, emojiId: string): Promise<void> {
    const res = await this.fetchAuth(`${API_BASE}/beacons/${beaconId}/emojis/${emojiId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete emoji');
  }

  public async joinBeacon(beaconId: string): Promise<void> {
    await this.fetchAuth(`${API_BASE}/beacons/${beaconId}/join`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    await this.fetchAuth(`${API_BASE}/beacons/${beaconId}/onboarding/complete`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  public async getVaultQuota(): Promise<VaultQuota> {
    const res = await this.fetchAuth(`${API_BASE}/vault/quota`);
    if (!res.ok) throw new Error('Failed to fetch quota');
    return res.json();
  }

  public async getVaultFiles(): Promise<VaultFile[]> {
    const res = await this.fetchAuth(`${API_BASE}/vault/files`);
    if (!res.ok) throw new Error('Failed to fetch vault files');
    const data = await res.json();
    return data.files || [];
  }

  public async deleteVaultFile(fileId: string): Promise<void> {
    const res = await this.fetchAuth(`${API_BASE}/vault/files/${fileId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete vault file');
  }

  public async acceptUploadDisclaimer(): Promise<{ hasAcceptedUploadDisclaimer: boolean }> {
    const res = await this.fetchAuth(`${API_BASE}/vault/disclaimer/accept`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error('Failed to accept upload disclaimer');
    return res.json();
  }

  public async getCloudIntegrations(): Promise<Record<string, CloudIntegration>> {
    try {
      const res = await this.fetchAuth(`${API_BASE}/vault/integrations/config`);
      if (res.ok) {
        const data = await res.json();
        if (data.integrations) return data.integrations;
      }
    } catch {
      /* integrations unavailable */
    }
    return {};
  }

  public async requestUploadTicket(filename: string, mimeType: string, sizeBytes: number): Promise<{
    storageKey: string;
    presignedUploadUrl: string;
    expiresInSeconds: number;
    bucket: string;
  }> {
    const res = await this.fetchAuth(`${API_BASE}/vault/upload-ticket`, {
      method: 'POST',
      body: JSON.stringify({ filename, mimeType, sizeBytes }),
    });
    if (res.status === 403) {
      const err = await res.json();
      if (err.code === 'DISCLAIMER_REQUIRED') {
        const error = new Error(err.error || 'Upload disclaimer required');
        (error as any).code = 'DISCLAIMER_REQUIRED';
        (error as any).disclaimerNotice = err.disclaimerNotice;
        throw error;
      }
      throw new Error(err.error || 'Upload forbidden');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to obtain upload ticket');
    }
    return res.json();
  }

  public async recordVaultFile(storageKey: string, filename: string, mimeType: string, sizeBytes: number): Promise<VaultFile> {
    const res = await this.fetchAuth(`${API_BASE}/vault/files`, {
      method: 'POST',
      body: JSON.stringify({ storageKey, filename, mimeType, sizeBytes }),
    });
    if (!res.ok) throw new Error('Failed to record vault file');
    const data = await res.json();
    return data.file;
  }

  public async uploadVaultFile(file: File): Promise<VaultFile> {
    const ticket = await this.requestUploadTicket(file.name, file.type || 'application/octet-stream', file.size);
    const put = await fetch(ticket.presignedUploadUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
    });
    if (!put.ok) throw new Error(`Upload to storage failed (${put.status})`);
    return this.recordVaultFile(ticket.storageKey, file.name, file.type || 'application/octet-stream', file.size);
  }

  // Comm-Link WebRTC Token
  public async getCommLinkToken(relayId: string): Promise<{
    message: string;
    token: string;
    livekitUrl: string;
    roomName: string;
    canSpeak: boolean;
    canHoloCast: boolean;
  }> {
    const res = await this.fetchAuth(`${API_BASE}/relays/${relayId}/comm-link/token`, {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Comm-Link connection rejected' }));
      throw new Error(err.error || 'Failed to get Comm-Link token');
    }
    const data = await res.json();
    // A null livekitUrl means LiveKit signaling is proxied on this origin at /rtc.
    const sameOrigin = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
    return { ...data, livekitUrl: data.livekitUrl || sameOrigin };
  }

  // Point-to-Point Links (DMs)
  public async getDirectLinks(): Promise<any[]> {
    const res = await this.fetchAuth(`${API_BASE}/links`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.links || [];
  }

  public async getLinkTransmissions(linkId: string): Promise<ApiTransmission[]> {
    const res = await this.fetchAuth(`${API_BASE}/links/${linkId}/transmissions`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.transmissions || [];
  }

  public async sendDirectTransmission(targetId: string, content: string): Promise<any> {
    const res = await this.fetchAuth(`${API_BASE}/links/${targetId}/transmissions`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Transmission rejected' }));
      throw new Error(err.error || 'Failed to send direct transmission');
    }
    return res.json();
  }

  public async respondTransmissionRequest(requestId: string, action: 'accept' | 'decline'): Promise<any> {
    const res = await this.fetchAuth(`${API_BASE}/links/requests/${requestId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    if (!res.ok) throw new Error('Failed to respond to transmission request');
    return res.json();
  }

  // Affiliations (Friends)
  public async getAffiliations(): Promise<any[]> {
    const res = await this.fetchAuth(`${API_BASE}/affiliations`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.affiliations || [];
  }

  public async sendAffiliationRequest(targetId: string, greetingNote?: string): Promise<any> {
    const res = await this.fetchAuth(`${API_BASE}/affiliations/request`, {
      method: 'POST',
      body: JSON.stringify({ targetId, greetingNote }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Friend request failed' }));
      throw new Error(err.error || 'Failed to send friend request');
    }
    return res.json();
  }

  public async acceptAffiliation(requestId: string): Promise<any> {
    const res = await this.fetchAuth(`${API_BASE}/affiliations/${requestId}/accept`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to accept affiliation');
    return res.json();
  }

  public async declineAffiliation(requestId: string): Promise<any> {
    const res = await this.fetchAuth(`${API_BASE}/affiliations/${requestId}/decline`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to decline affiliation');
    return res.json();
  }

  // Signal Blacklist (Blocking)
  public async blockTarget(targetId: string, targetType: 'transmitter' | 'transmission' | 'beacon' = 'transmitter'): Promise<any> {
    const res = await this.fetchAuth(`${API_BASE}/blacklist`, {
      method: 'POST',
      body: JSON.stringify({ targetId, targetType }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Block failed' }));
      throw new Error(err.error || 'Failed to block target');
    }
    return res.json();
  }

  public async unblockTarget(targetId: string): Promise<any> {
    const res = await this.fetchAuth(`${API_BASE}/blacklist/${targetId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to unblock target');
    return res.json();
  }

  public async getBlacklist(): Promise<any[]> {
    const res = await this.fetchAuth(`${API_BASE}/blacklist`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.blacklist || [];
  }

  // Subspace Meshes (Group DMs)
  public async getMeshes(): Promise<any[]> {
    const res = await this.fetchAuth(`${API_BASE}/meshes`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.meshes || [];
  }

  public async createMesh(name: string, memberIds: string[] = []): Promise<any> {
    const res = await this.fetchAuth(`${API_BASE}/meshes`, {
      method: 'POST',
      body: JSON.stringify({ name, memberIds }),
    });
    if (!res.ok) throw new Error('Failed to create Subspace Mesh');
    const data = await res.json();
    return data.mesh;
  }

  public async getMeshTransmissions(meshId: string): Promise<ApiTransmission[]> {
    const res = await this.fetchAuth(`${API_BASE}/meshes/${meshId}/transmissions`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.transmissions || [];
  }

  public async sendMeshTransmission(meshId: string, content: string): Promise<any> {
    const res = await this.fetchAuth(`${API_BASE}/meshes/${meshId}/transmissions`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error('Failed to dispatch mesh transmission');
    return res.json();
  }

  // Quick Scan Global Search
  public async quickScanSearch(query: string): Promise<{
    beacons: any[];
    relays: any[];
    transmitters: any[];
  }> {
    if (!query.trim()) return { beacons: [], relays: [], transmitters: [] };
    const res = await this.fetchAuth(`${API_BASE}/search/quick-scan?q=${encodeURIComponent(query.trim())}`);
    if (!res.ok) return { beacons: [], relays: [], transmitters: [] };
    return res.json();
  }

  // Archival Forum Threads
  public async getArchivalThreads(relayId: string, tag?: string): Promise<{ threads: any[] }> {
    const url = `${API_BASE}/relays/${relayId}/archival/threads${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`;
    const res = await this.fetchAuth(url);
    if (!res.ok) throw new Error('Failed to load archival threads');
    return res.json();
  }

  public async getArchivalThread(relayId: string, threadId: string): Promise<any> {
    const res = await this.fetchAuth(`${API_BASE}/relays/${relayId}/archival/threads/${threadId}`);
    if (!res.ok) throw new Error('Failed to load archival thread');
    return res.json();
  }

  public async getArchivalThreadTransmissions(relayId: string, threadId: string): Promise<{ threadId: string; transmissions: any[] }> {
    const res = await this.fetchAuth(`${API_BASE}/relays/${relayId}/archival/threads/${threadId}/transmissions`);
    if (!res.ok) throw new Error('Failed to load thread transmissions');
    return res.json();
  }

  public async createArchivalThread(relayId: string, title: string, content: string, tags: string[] = []): Promise<any> {
    const res = await this.fetchAuth(`${API_BASE}/relays/${relayId}/archival/threads`, {
      method: 'POST',
      body: JSON.stringify({ title, content, tags }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to create thread' }));
      throw new Error(err.error || 'Failed to create thread');
    }
    return res.json();
  }

  public async sendArchivalThreadReply(relayId: string, threadId: string, content: string): Promise<any> {
    const res = await this.fetchAuth(`${API_BASE}/relays/${relayId}/archival/threads/${threadId}/transmissions`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to post reply' }));
      throw new Error(err.error || 'Failed to post reply');
    }
    return res.json();
  }

  public async updateArchivalThread(
    relayId: string,
    threadId: string,
    updates: { isLocked?: boolean; isPinned?: boolean; title?: string; tags?: string[] }
  ): Promise<any> {
    const res = await this.fetchAuth(`${API_BASE}/relays/${relayId}/archival/threads/${threadId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to update thread parameters' }));
      throw new Error(err.error || 'Failed to update thread');
    }
    return res.json();
  }
}

export interface CloudIntegration {
  provider: 'google' | 'onedrive' | 'dropbox';
  name: string;
  isEnabled: boolean;
  clientId?: string;
  apiKey?: string;
}

export interface VaultQuota {
  quotaBytes: number;
  usedBytes: number;
  remainingBytes: number;
  fileCount: number;
  hasAcceptedUploadDisclaimer: boolean;
}

export interface VaultFile {
  id: string;
  transmitterId: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: string;
  isQuarantined: boolean;
  createdAt: string;
  downloadUrl?: string;
}

export const api = new SubspaceApiClient();
