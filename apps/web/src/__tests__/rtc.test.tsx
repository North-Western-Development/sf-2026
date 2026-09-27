import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LiveKitRoomManager } from '../services/rtc';
import { ConnectionState } from 'livekit-client';

// Mock livekit-client
vi.mock('livekit-client', () => {
  const ConnectionState = {
    Disconnected: 'disconnected',
    Connecting: 'connecting',
    Connected: 'connected',
    Reconnecting: 'reconnecting',
  };

  class MockRoom {
    state = ConnectionState.Disconnected;
    localParticipant = {
      publishTrack: vi.fn().mockResolvedValue({}),
      unpublishTrack: vi.fn().mockResolvedValue({}),
    };
    private listeners: Record<string, Function[]> = {};

    on(event: string, fn: Function) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(fn);
      return this;
    }

    emit(event: string, ...args: any[]) {
      (this.listeners[event] || []).forEach(fn => fn(...args));
    }

    async connect() {
      this.state = ConnectionState.Connected;
      this.emit('connectionStateChanged', ConnectionState.Connected);
    }

    async disconnect() {
      this.state = ConnectionState.Disconnected;
      this.emit('connectionStateChanged', ConnectionState.Disconnected);
    }
  }

  return {
    Room: MockRoom,
    RoomEvent: {
      ConnectionStateChanged: 'connectionStateChanged',
      ActiveSpeakersChanged: 'activeSpeakersChanged',
      TrackSubscribed: 'trackSubscribed',
      TrackUnsubscribed: 'trackUnsubscribed',
    },
    Track: {
      Kind: { Audio: 'audio', Video: 'video' },
    },
    ConnectionState,
    createLocalAudioTrack: vi.fn().mockResolvedValue({
      mute: vi.fn(),
      unmute: vi.fn(),
      stop: vi.fn(),
    }),
    createLocalVideoTrack: vi.fn().mockResolvedValue({
      mute: vi.fn(),
      unmute: vi.fn(),
      stop: vi.fn(),
    }),
    createLocalScreenTracks: vi.fn().mockResolvedValue([
      {
        kind: 'video',
        mute: vi.fn(),
        unmute: vi.fn(),
        stop: vi.fn(),
      },
    ]),
  };
});

describe('LiveKitRoomManager WebRTC Service', () => {
  let rtc: LiveKitRoomManager;

  beforeEach(() => {
    rtc = new LiveKitRoomManager();
  });

  it('connects to LiveKit SFU room and transitions state to Connected', async () => {
    let observedState: ConnectionState | null = null;
    rtc.onConnectionStateChanged((state) => {
      observedState = state;
    });

    await rtc.connect('ws://localhost:7880', 'fake-jwt-token', { canSpeak: true });

    expect(rtc.isConnected).toBe(true);
    expect(observedState).toBe('connected');
  });

  it('notifies subscribers when active speakers change', async () => {
    let speakers: string[] = [];
    rtc.onSpeakingChanged((s) => {
      speakers = s;
    });

    await rtc.connect('ws://localhost:7880', 'fake-jwt-token');

    // Simulate ActiveSpeakersChanged room event
    (rtc.currentRoom as any)?.emit('activeSpeakersChanged', [
      { identity: 'adm_vance' },
      { identity: 'echo_four' },
    ]);

    expect(speakers).toEqual(['adm_vance', 'echo_four']);
  });

  it('supports muting and unmuting microphone', async () => {
    await rtc.connect('ws://localhost:7880', 'fake-jwt-token');

    await rtc.setMicrophoneEnabled(false);
    // Should execute without errors
    await rtc.setMicrophoneEnabled(true);
  });

  it('handles clean disconnect and stops tracks', async () => {
    await rtc.connect('ws://localhost:7880', 'fake-jwt-token');
    expect(rtc.isConnected).toBe(true);

    await rtc.disconnect();
    expect(rtc.isConnected).toBe(false);
    expect(rtc.currentRoom).toBeNull();
  });
});
