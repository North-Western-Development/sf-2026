import React, { useEffect, useRef } from 'react';
import { MicOff, Headphones, Monitor, Video as VideoIcon } from 'lucide-react';
import { Track } from 'livekit-client';

export interface VoiceParticipantTileProps {
  id: string;
  name: string;
  avatar: string;
  isLocal?: boolean;
  isSpeaking?: boolean;
  isMuted?: boolean;
  isDeafened?: boolean;
  isVideoOn?: boolean;
  isScreenSharing?: boolean;
  videoTrack?: Track | null;
}

export const VoiceParticipantTile: React.FC<VoiceParticipantTileProps> = ({
  name,
  avatar,
  isLocal = false,
  isSpeaking = false,
  isMuted = false,
  isDeafened = false,
  isVideoOn = false,
  isScreenSharing = false,
  videoTrack,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (el && videoTrack) {
      videoTrack.attach(el);
      return () => {
        try {
          videoTrack.detach(el);
        } catch {
          // ignore
        }
      };
    }
  }, [videoTrack, isVideoOn, isScreenSharing]);

  const hasVideo = Boolean(videoTrack || isVideoOn || isScreenSharing);

  return (
    <div
      className={`group relative w-full h-full min-h-[220px] rounded-[16px] overflow-hidden flex flex-col items-center justify-center transition-all select-none shadow-2xl ${
        isSpeaking
          ? 'ring-4 ring-[#23a55a] shadow-[0_0_20px_rgba(35,165,90,0.35)]'
          : 'border border-[#1f2024]'
      } bg-[#0b0c0e]`}
    >
      {/* Video Surface */}
      {hasVideo ? (
        <div className="absolute inset-0 w-full h-full bg-black flex items-center justify-center">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isLocal}
            className={`w-full h-full object-cover ${
              isLocal && !isScreenSharing ? 'scale-x-[-1]' : ''
            }`}
          />
          {/* Video / Stream Type Badge */}
          <div className="absolute top-3 left-3 bg-black/75 backdrop-blur-md px-2 py-0.5 rounded-[4px] text-[10px] font-mono uppercase tracking-wider text-[#00f0ff] border border-[#00f0ff]/30 flex items-center gap-1.5 z-10">
            {isScreenSharing ? (
              <>
                <Monitor className="w-3 h-3 text-[#00f0ff]" />
                <span>Holo-Cast Stream</span>
              </>
            ) : (
              <>
                <VideoIcon className="w-3 h-3 text-[#23a55a]" />
                <span>Optical Feed</span>
              </>
            )}
          </div>
        </div>
      ) : (
        /* Avatar Surface */
        <div className="flex flex-col items-center justify-center">
          <div
            className={`w-24 h-24 rounded-full bg-[#000000] border-2 flex items-center justify-center text-4xl shadow-inner mb-2 transition-all ${
              isSpeaking
                ? 'border-[#23a55a] shadow-[0_0_24px_rgba(35,165,90,0.4)]'
                : 'border-[#1f2024]'
            }`}
          >
            {avatar}
          </div>
        </div>
      )}

      {/* Participant Identity Pill Footer */}
      <div className="absolute bottom-3 left-3 bg-black/80 backdrop-blur-md px-2.5 py-1 rounded-[6px] text-xs font-semibold text-white flex items-center gap-2 border border-white/10 z-10">
        <span className="truncate max-w-[140px]">{name}</span>
        {isLocal && <span className="text-[10px] text-[#00f0ff] font-normal">(You)</span>}
        {isSpeaking && (
          <span className="w-2 h-2 rounded-full bg-[#23a55a] animate-pulse shadow-[0_0_8px_#23a55a]" />
        )}
      </div>

      {/* Status Icons Overlay */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1.5 z-10">
        {isDeafened && (
          <div className="bg-[#f23f43]/90 backdrop-blur-md p-1.5 rounded-full text-white shadow" title="Deafened">
            <Headphones className="w-3.5 h-3.5" />
          </div>
        )}
        {isMuted && !isDeafened && (
          <div className="bg-[#1e1f22]/90 backdrop-blur-md p-1.5 rounded-full text-[#f23f43] border border-[#f23f43]/30 shadow" title="Muted">
            <MicOff className="w-3.5 h-3.5" />
          </div>
        )}
      </div>
    </div>
  );
};
