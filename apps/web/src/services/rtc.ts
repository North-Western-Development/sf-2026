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
  KeyProviderEvent,
  createKeyMaterialFromString,
} from 'livekit-client';
import { gateMicrophone, inputDeviceId } from '../lib/voicePrefs';

/**
 * The shared frame keys of an encrypted room, by index. A rotated key is first installed for
 * receiving only, then made the sending key once everyone has it, so no frame goes unreadable.
 */
class RoomKeyProvider extends ExternalE2EEKeyProvider {
  async setIndexedKey(key: string, index: number, makeCurrent: boolean) {
    const material = await createKeyMaterialFromString(key);
    if (makeCurrent) this.onSetEncryptionKey(material, undefined, index);
    else this.emit(KeyProviderEvent.SetKey, { key: material, keyIndex: index }, false);
  }
}

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
  /** Stops the input-sensitivity gate on the microphone. */
  private stopGate: (() => void) | null = null;
  private localVideoTrack: LocalVideoTrack | null = null;
  private localScreenTrack: LocalVideoTrack | null = null;
  private attachedAudioElements: Map<string, HTMLAudioElement> = new Map();
  /** Whose audio each element plays, for Priority Speaker ducking. */
  private audioOwners = new WeakMap<HTMLAudioElement, string>();
  private priorityTalkers: Set<string> = new Set();
  private isDeafened: boolean = false;
  private isMuted: boolean = false;
  private keyProvider: RoomKeyProvider | null = null;

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

  /**
   * Set the shared frame key of an encrypted room (base64url of 32 random bytes) at a keyring
   * index. `makeCurrent` false installs it for decrypting only; sending switches later.
   */
  public async setE2EEKey(key: string, index = 0, makeCurrent = true): Promise<void> {
    await this.keyProvider?.setIndexedKey(key, index, makeCurrent);
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
    options?: { canSpeak?: boolean; isMuted?: boolean; isDeafened?: boolean; e2ee?: boolean; e2eeKey?: string; e2eeKeyIndex?: number; forceRelay?: boolean }
  ): Promise<Room> {
    if (this.room) {
      await this.disconnect();
    }

    this.isMuted = options?.isMuted ?? false;
    this.isDeafened = options?.isDeafened ?? false;

    // End-to-end encrypted rooms: every audio/video frame is encrypted in a worker before it
    // leaves the browser, with a key only the participants hold (set via setE2EEKey).
    this.keyProvider = options?.e2ee ? new RoomKeyProvider() : null;
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      ...(this.keyProvider
        ? { e2ee: { keyProvider: this.keyProvider, worker: new Worker(new URL('livekit-client/e2ee-worker', import.meta.url), { type: 'module' }) } }
        : {}),
    });
    if (this.keyProvider) {
      if (options?.e2eeKey) await this.keyProvider.setIndexedKey(options.e2eeKey, options.e2eeKeyIndex ?? 0, true);
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
        this.audioOwners.set(el, participant.identity);
        this.attachedAudioElements.set(track.sid || participant.identity, el);
        this.applyDucking();
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

    // forceRelay (the instance's LIVEKIT_FORCE_RELAY): media only through LiveKit's TURN server,
    // whose address and credentials come with the join response.
    await room.connect(url, token, options?.forceRelay ? { rtcConfig: { iceTransportPolicy: 'relay' } } : undefined);

    // Auto-publish audio if permitted and microphone is unmuted
    if (options?.canSpeak !== false) {
      try {
        const audioTrack = await createLocalAudioTrack({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          deviceId: inputDeviceId(),
        });
        this.localAudioTrack = audioTrack;
        if (this.isMuted) {
          audioTrack.mute();
        }
        await room.localParticipant.publishTrack(audioTrack);
        // The input-sensitivity gate starts once the track is out (it only ever silences it).
        this.stopGate = gateMicrophone(audioTrack.mediaStreamTrack, () => audioTrack.isMuted);
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
        const audioTrack = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, deviceId: inputDeviceId() });
        this.localAudioTrack = audioTrack;
        await this.room.localParticipant.publishTrack(audioTrack);
        this.stopGate = gateMicrophone(audioTrack.mediaStreamTrack, () => audioTrack.isMuted);
      } catch (err) {
        console.warn('Failed to enable mic:', err);
      }
    }
  }

  private speakingStart: Promise<void> | null = null;

  /**
   * On a Stage: publish the microphone once a moderator made us a speaker. The server grants
   * publishing through LiveKit first; the grant can reach this connection a moment after the
   * Stage update does, so wait for it.
   */
  public startSpeaking(): Promise<void> {
    if (!this.room || this.localAudioTrack) return Promise.resolve();
    this.speakingStart ??= this.publishStageMic().finally(() => (this.speakingStart = null));
    return this.speakingStart;
  }

  private async publishStageMic(): Promise<void> {
    const room = this.room;
    if (!room) return;
    if (!room.localParticipant.permissions?.canPublish) {
      await new Promise<void>((resolve) => {
        const done = () => {
          room.off(RoomEvent.ParticipantPermissionsChanged, check);
          clearTimeout(timer);
          resolve();
        };
        const check = () => room.localParticipant.permissions?.canPublish && done();
        const timer = setTimeout(done, 8000);
        room.on(RoomEvent.ParticipantPermissionsChanged, check);
      });
    }
    if (this.room !== room || this.localAudioTrack) return;
    try {
      const audioTrack = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, deviceId: inputDeviceId() });
      if (this.isMuted) await audioTrack.mute();
      this.localAudioTrack = audioTrack;
      await room.localParticipant.publishTrack(audioTrack);
      this.stopGate = gateMicrophone(audioTrack.mediaStreamTrack, () => audioTrack.isMuted);
    } catch (err) {
      console.warn('Could not start speaking:', err);
    }
  }

  /** Back to a Stage's audience: stop publishing the microphone and any camera or Holo-Cast. */
  public async stopSpeaking(): Promise<void> {
    await this.speakingStart?.catch(() => {});
    this.stopGate?.();
    this.stopGate = null;
    const tracks = [this.localAudioTrack, this.localVideoTrack, this.localScreenTrack];
    this.localAudioTrack = this.localVideoTrack = this.localScreenTrack = null;
    for (const t of tracks) {
      if (!t) continue;
      await this.room?.localParticipant.unpublishTrack(t).catch(() => {});
      t.stop();
    }
  }

  /**
   * Priority Speaker: while someone holding it talks, everyone else is played at a fifth of
   * their volume, as Discord does.
   */
  public setPriorityTalkers(identities: string[]): void {
    this.priorityTalkers = new Set(identities);
    this.applyDucking();
  }

  private applyDucking() {
    const ducking = this.priorityTalkers.size > 0;
    this.attachedAudioElements.forEach((el) => {
      const owner = this.audioOwners.get(el) ?? '';
      el.volume = ducking && !this.priorityTalkers.has(owner) ? 0.2 : 1;
    });
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
    this.stopGate?.();
    this.stopGate = null;
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

  /** What a clip records: my Holo-Cast, and the room's audio (my microphone and everyone I hear). */
  public getClipSources(): { video: MediaStreamTrack | null; audio: MediaStreamTrack[] } {
    const audio: MediaStreamTrack[] = [];
    const mic = this.localAudioTrack?.mediaStreamTrack;
    if (mic && !this.isMuted) audio.push(mic);
    this.room?.remoteParticipants.forEach((p) =>
      p.audioTrackPublications.forEach((pub) => {
        const t = pub.track?.mediaStreamTrack;
        if (t) audio.push(t);
      })
    );
    return { video: this.localScreenTrack?.mediaStreamTrack ?? null, audio };
  }
}

export const rtcManager = new LiveKitRoomManager();

