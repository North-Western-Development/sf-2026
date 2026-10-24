import {
  Room,
  RoomEvent,
  Track,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  LocalAudioTrack,
  LocalVideoTrack,
  createLocalAudioTrack,
  createLocalVideoTrack,
  createLocalScreenTracks,
  ConnectionState,
  ExternalE2EEKeyProvider,
} from 'livekit-client';

export type SpeakingCallback = (speakerIdentities: string[]) => void;
export type ConnectionStateCallback = (state: ConnectionState) => void;
export type TrackSubscribedCallback = (
  track: RemoteTrack,
  publication: RemoteTrackPublication,
  participant: RemoteParticipant
) => void;
export type TrackUnsubscribedCallback = (
  track: RemoteTrack,
  publication: RemoteTrackPublication,
  participant: RemoteParticipant
) => void;

export class LiveKitRoomManager {
  private room: Room | null = null;
  private localAudioTrack: LocalAudioTrack | null = null;
  private localVideoTrack: LocalVideoTrack | null = null;
  private localScreenTrack: LocalVideoTrack | null = null;
  private attachedAudioElements: Map<string, HTMLAudioElement> = new Map();
  private isDeafened: boolean = false;
  private isMuted: boolean = false;
  private keyProvider: ExternalE2EEKeyProvider | null = null;

  private speakingListeners: Set<SpeakingCallback> = new Set();
  private connectionStateListeners: Set<ConnectionStateCallback> = new Set();
  private trackSubscribedListeners: Set<TrackSubscribedCallback> = new Set();
  private trackUnsubscribedListeners: Set<TrackUnsubscribedCallback> = new Set();

  public get currentRoom(): Room | null {
    return this.room;
  }

  /** Whether frames in the current room are end-to-end encrypted. */
  public get isEncrypted(): boolean {
    return !!this.keyProvider && !!this.room?.isE2EEEnabled;
  }

  /** Set (or replace) the shared frame key of an encrypted room (base64url of 32 random bytes). */
  public async setE2EEKey(key: string): Promise<void> {
    await this.keyProvider?.setKey(key);
  }

  public get isConnected(): boolean {
    return this.room?.state === ConnectionState.Connected;
  }

  public onSpeakingChanged(cb: SpeakingCallback): () => void {
    this.speakingListeners.add(cb);
    return () => this.speakingListeners.delete(cb);
  }

  public onConnectionStateChanged(cb: ConnectionStateCallback): () => void {
    this.connectionStateListeners.add(cb);
    return () => this.connectionStateListeners.delete(cb);
  }

  public onTrackSubscribed(cb: TrackSubscribedCallback): () => void {
    this.trackSubscribedListeners.add(cb);
    return () => this.trackSubscribedListeners.delete(cb);
  }

  public onTrackUnsubscribed(cb: TrackUnsubscribedCallback): () => void {
    this.trackUnsubscribedListeners.add(cb);
    return () => this.trackUnsubscribedListeners.delete(cb);
  }

  public async connect(
    url: string,
    token: string,
    options?: { canSpeak?: boolean; isMuted?: boolean; isDeafened?: boolean; e2ee?: boolean; e2eeKey?: string }
  ): Promise<Room> {
    if (this.room) {
      await this.disconnect();
    }

    this.isMuted = options?.isMuted ?? false;
    this.isDeafened = options?.isDeafened ?? false;

    // End-to-end encrypted rooms: every audio/video frame is encrypted in a worker before it
    // leaves the browser, with a key only the participants hold (set via setE2EEKey).
    this.keyProvider = options?.e2ee ? new ExternalE2EEKeyProvider() : null;
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      ...(this.keyProvider
        ? { e2ee: { keyProvider: this.keyProvider, worker: new Worker(new URL('livekit-client/e2ee-worker', import.meta.url), { type: 'module' }) } }
        : {}),
    });
    if (this.keyProvider) {
      if (options?.e2eeKey) await this.keyProvider.setKey(options.e2eeKey);
      await room.setE2EEEnabled(true);
    }

    this.room = room;

    room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      this.connectionStateListeners.forEach(cb => cb(state));
    });

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const identities = speakers.map(s => s.identity);
      this.speakingListeners.forEach(cb => cb(identities));
    });

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach() as HTMLAudioElement;
        el.muted = this.isDeafened;
        this.attachedAudioElements.set(track.sid || participant.identity, el);
      }
      this.trackSubscribedListeners.forEach(cb => cb(track, publication, participant));
    });

    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track.kind === Track.Kind.Audio) {
        track.detach();
        const key = track.sid || participant.identity;
        const el = this.attachedAudioElements.get(key);
        if (el) {
          el.remove();
          this.attachedAudioElements.delete(key);
        }
      }
      this.trackUnsubscribedListeners.forEach(cb => cb(track, publication, participant));
    });

    await room.connect(url, token);

    // Auto-publish audio if permitted and microphone is unmuted
    if (options?.canSpeak !== false) {
      try {
        const audioTrack = await createLocalAudioTrack({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        });
        this.localAudioTrack = audioTrack;
        if (this.isMuted) {
          audioTrack.mute();
        }
        await room.localParticipant.publishTrack(audioTrack);
      } catch (err) {
        console.warn('Microphone permission denied or unavailable:', err);
      }
    }

    return room;
  }

  public async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    this.isMuted = !enabled;
    if (!this.room) return;

    if (this.localAudioTrack) {
      if (enabled) {
        await this.localAudioTrack.unmute();
      } else {
        await this.localAudioTrack.mute();
      }
    } else if (enabled) {
      try {
        const audioTrack = await createLocalAudioTrack();
        this.localAudioTrack = audioTrack;
        await this.room.localParticipant.publishTrack(audioTrack);
      } catch (err) {
        console.warn('Failed to enable mic:', err);
      }
    }
  }

  public setDeafened(deafened: boolean): void {
    this.isDeafened = deafened;
    this.attachedAudioElements.forEach(el => {
      el.muted = deafened;
    });
  }

  public async setCameraEnabled(enabled: boolean): Promise<LocalVideoTrack | null> {
    if (!this.room) return null;

    if (enabled) {
      if (!this.localVideoTrack) {
        try {
          const videoTrack = await createLocalVideoTrack({
            resolution: { width: 1280, height: 720, frameRate: 30 }
          });
          this.localVideoTrack = videoTrack;
          await this.room.localParticipant.publishTrack(videoTrack);
          return videoTrack;
        } catch (err) {
          console.warn('Failed to enable camera:', err);
          return null;
        }
      } else {
        await this.localVideoTrack.unmute();
        return this.localVideoTrack;
      }
    } else {
      if (this.localVideoTrack) {
        await this.localVideoTrack.mute();
        await this.room.localParticipant.unpublishTrack(this.localVideoTrack);
        this.localVideoTrack.stop();
        this.localVideoTrack = null;
      }
      return null;
    }
  }

  public async setScreenShareEnabled(enabled: boolean): Promise<LocalVideoTrack | null> {
    if (!this.room) return null;

    if (enabled) {
      try {
        const tracks = await createLocalScreenTracks({ audio: true });
        const videoTrack = tracks.find(t => t.kind === Track.Kind.Video) as LocalVideoTrack | undefined;
        if (videoTrack) {
          this.localScreenTrack = videoTrack;
          await this.room.localParticipant.publishTrack(videoTrack);
          return videoTrack;
        }
        return null;
      } catch (err) {
        console.warn('Failed to start screen share:', err);
        return null;
      }
    } else {
      if (this.localScreenTrack) {
        await this.room.localParticipant.unpublishTrack(this.localScreenTrack);
        this.localScreenTrack.stop();
        this.localScreenTrack = null;
      }
      return null;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.localAudioTrack) {
      this.localAudioTrack.stop();
      this.localAudioTrack = null;
    }
    if (this.localVideoTrack) {
      this.localVideoTrack.stop();
      this.localVideoTrack = null;
    }
    if (this.localScreenTrack) {
      this.localScreenTrack.stop();
      this.localScreenTrack = null;
    }

    this.attachedAudioElements.forEach(el => {
      el.pause();
      el.remove();
    });
    this.attachedAudioElements.clear();

    if (this.room) {
      await this.room.disconnect();
      this.room = null;
    }
  }

  public getLocalAudioTrack(): LocalAudioTrack | null {
    return this.localAudioTrack;
  }

  public getLocalVideoTrack(): LocalVideoTrack | null {
    return this.localVideoTrack;
  }

  public getLocalScreenTrack(): LocalVideoTrack | null {
    return this.localScreenTrack;
  }
}

export const rtcManager = new LiveKitRoomManager();
