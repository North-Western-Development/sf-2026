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

class SubspaceApiClient {
  private token: string | null = null;
  private transmitter: TransmitterProfile | null = null;

  constructor() {
    this.token = localStorage.getItem('subspace_access_token');
    const storedUser = localStorage.getItem('subspace_user');
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

  public async login(username = 'command_officer', password = 'subspace2026!'): Promise<TransmitterProfile> {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(err.error || err.message || 'Authentication error');
    }

    const data = await res.json();
    this.token = data.accessToken;
    this.transmitter = data.transmitter;
    localStorage.setItem('subspace_access_token', this.token!);
    localStorage.setItem('subspace_user', JSON.stringify(this.transmitter));
    return this.transmitter!;
  }

  public async ensureAuthenticated(): Promise<TransmitterProfile> {
    if (this.token && this.transmitter) {
      return this.transmitter;
    }
    return this.login();
  }

  private async fetchAuth(url: string, options: RequestInit = {}): Promise<Response> {
    await this.ensureAuthenticated();
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
      ...(options.headers || {}),
    };

    let res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      // Re-login on expired token
      await this.login();
      (headers as any).Authorization = `Bearer ${this.token}`;
      res = await fetch(url, { ...options, headers });
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
      // Fallback to configured defaults
    }
    return {
      google: { provider: 'google', name: 'Google Drive', isEnabled: true, clientId: '448110191150-r7racvvpsod6avnjfh6ubi123pco5omq.apps.googleusercontent.com' },
      onedrive: { provider: 'onedrive', name: 'Microsoft OneDrive', isEnabled: true, clientId: 'deefc586-cdcb-427e-b6a5-60d139deaf4b' },
      dropbox: { provider: 'dropbox', name: 'Dropbox', isEnabled: true, clientId: '1xxu145p7r3u75m' },
    };
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
    await fetch(ticket.presignedUploadUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
    });
    return this.recordVaultFile(ticket.storageKey, file.name, file.type || 'application/octet-stream', file.size);
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
