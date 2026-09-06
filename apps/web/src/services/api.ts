// Real Subspace Frequency API Service Client

const API_BASE = '/api/v1';

export interface TransmitterProfile {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  displayColor?: string;
  displayFont?: string;
  avatarUrl?: string | null;
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
    displayName?: string;
    displayColor?: string;
    avatarUrl?: string | null;
    staffRank?: number;
  };
}

export interface ApiMember {
  transmitterId: string;
  username: string;
  displayName: string;
  displayColor?: string;
  displayFont?: string;
  avatarUrl?: string | null;
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
}

export const api = new SubspaceApiClient();
