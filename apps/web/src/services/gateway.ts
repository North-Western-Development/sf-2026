// Real Subspace Frequency Gateway WebSocket Client
import { api } from './api';

export interface VoiceStateEvent {
  transmitter_id: string;
  username: string;
  relay_id: string | null;
  is_muted: boolean;
  is_deafened: boolean;
  is_speaking: boolean;
  timestamp: string;
}

export interface PresenceEvent {
  transmitter_id: string;
  presence: 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';
  timestamp: string;
}

export interface TransmissionEvent {
  type: string;
  action?: 'create' | 'update' | 'delete';
  relay_id?: string;
  beacon_id?: string;
  transmission?: any;
  transmissionId?: string;
  link_id?: string;
  recipient_id?: string;
  sender_id?: string;
  mesh_id?: string;
  request?: any;
}

type EventListener<T> = (data: T) => void;

class SubspaceGatewayClient {
  private ws: WebSocket | null = null;
  private heartbeatInterval: number = 30000;
  private heartbeatTimer: any = null;
  private isConnecting: boolean = false;
  private voiceListeners: Set<EventListener<VoiceStateEvent>> = new Set();
  private presenceListeners: Set<EventListener<PresenceEvent>> = new Set();
  private transmissionListeners: Set<EventListener<TransmissionEvent>> = new Set();
  private readyListeners: Set<EventListener<{ transmitter: any; voice_states: any[] }>> = new Set();
  private cachedVoiceStates: Map<string, VoiceStateEvent> = new Map();

  private shouldReconnect = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  public connect() {
    this.shouldReconnect = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this.isConnecting) return;
    this.isConnecting = true;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/gateway`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.isConnecting = false;
    };

    this.ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        this.handlePayload(payload);
      } catch (err) {
        console.warn('[Gateway] Malformed event payload:', err);
      }
    };

    this.ws.onclose = () => {
      this.isConnecting = false;
      this.stopHeartbeat();
      this.ws = null;
      if (!this.shouldReconnect) return;
      // Exponential backoff with jitter, capped at 30s.
      const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts) * (0.75 + Math.random() * 0.5);
      this.reconnectAttempts += 1;
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  /** Close the socket and stop reconnecting (sign-out). */
  public disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.cachedVoiceStates.clear();
  }

  private handlePayload(payload: any) {
    // 10: HELLO -> Send IDENTIFY
    if (payload.op === 10) {
      this.heartbeatInterval = payload.d?.heartbeat_interval || 30000;
      this.startHeartbeat();

      void api.getValidToken().then((token) => {
        if (!token) {
          this.disconnect();
          return;
        }
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ op: 2 /* IDENTIFY */, d: { token, presence: 'online' } }));
        }
      });
      return;
    }

    // 11: HEARTBEAT_ACK
    if (payload.op === 11) {
      return;
    }

    // 0: DISPATCH
    if (payload.op === 0) {
      if (payload.t === 'READY') {
        this.reconnectAttempts = 0;
        const voiceStates = payload.d?.voice_states || [];
        voiceStates.forEach((vs: any) => {
          if (vs.relay_id) {
            this.cachedVoiceStates.set(vs.transmitter_id, {
              transmitter_id: vs.transmitter_id,
              username: vs.username,
              relay_id: vs.relay_id,
              is_muted: !!vs.is_muted,
              is_deafened: !!vs.is_deafened,
              is_speaking: !!vs.is_speaking,
              timestamp: new Date().toISOString(),
            });
          }
        });
        this.readyListeners.forEach((fn) => fn(payload.d));
      } else if (payload.t === 'VOICE_STATE_UPDATE') {
        const evt: VoiceStateEvent = payload.d;
        if (evt.relay_id) {
          this.cachedVoiceStates.set(evt.transmitter_id, evt);
        } else {
          this.cachedVoiceStates.delete(evt.transmitter_id);
        }
        this.voiceListeners.forEach((fn) => fn(evt));
      } else if (payload.t === 'PRESENCE_UPDATE') {
        this.presenceListeners.forEach((fn) => fn(payload.d));
      } else if (
        payload.t === 'TRANSMISSION_CREATE' ||
        payload.t === 'TRANSMISSION_UPDATE' ||
        payload.t === 'TRANSMISSION_DELETE' ||
        payload.t === 'DIRECT_TRANSMISSION_CREATE' ||
        payload.t === 'MESH_TRANSMISSION_CREATE' ||
        payload.t === 'TRANSMISSION_REQUEST_CREATE'
      ) {
        const evt: TransmissionEvent = payload.d;
        this.transmissionListeners.forEach((fn) => fn(evt));
      }
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op: 1 })); // HEARTBEAT
      }
    }, this.heartbeatInterval);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public updateVoiceState(relayId: string | null, isMuted = false, isDeafened = false, isSpeaking = false) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          op: 4, // VOICE_STATE_UPDATE
          d: {
            relay_id: relayId,
            is_muted: isMuted,
            is_deafened: isDeafened,
            is_speaking: isSpeaking,
          },
        })
      );
    }
  }

  public getCachedVoiceUsersForRelay(relayId: string): VoiceStateEvent[] {
    const list: VoiceStateEvent[] = [];
    this.cachedVoiceStates.forEach((val) => {
      if (val.relay_id === relayId) list.push(val);
    });
    return list;
  }

  public onVoiceState(fn: EventListener<VoiceStateEvent>) {
    this.voiceListeners.add(fn);
    return () => this.voiceListeners.delete(fn);
  }

  public onPresence(fn: EventListener<PresenceEvent>) {
    this.presenceListeners.add(fn);
    return () => this.presenceListeners.delete(fn);
  }

  public onTransmission(fn: EventListener<TransmissionEvent>) {
    this.transmissionListeners.add(fn);
    return () => this.transmissionListeners.delete(fn);
  }

  public onReady(fn: EventListener<{ transmitter: any; voice_states: any[] }>) {
    this.readyListeners.add(fn);
    return () => this.readyListeners.delete(fn);
  }
}

export const gateway = new SubspaceGatewayClient();
