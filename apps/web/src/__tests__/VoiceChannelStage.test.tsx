import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VoiceParticipantTile } from '../components/VoiceParticipantTile';
import { Volume2, Mic, MicOff, Headphones, Video, Monitor, Sparkles, PhoneOff, UserPlus } from 'lucide-react';

interface VoiceUser {
  id: string;
  name: string;
  avatar: string;
  isSpeaking?: boolean;
  isMuted?: boolean;
  isDeafened?: boolean;
}

interface MockVoiceStageProps {
  currentChannel: { id: string; name: string; type: 'voice' };
  currentUser: { callsign: string; name: string; avatar: string; id: string };
  inVoiceRoom: string | null;
  voiceUsers: Record<string, VoiceUser[]>;
  isMuted?: boolean;
  isDeafened?: boolean;
  isVideoOn?: boolean;
  isScreenSharing?: boolean;
  onJoinVoice?: () => void;
  onDisconnect?: () => void;
}

// Extracted representation of the Voice Channel Stage component in App.tsx
function VoiceChannelStage({
  currentChannel,
  currentUser,
  inVoiceRoom,
  voiceUsers,
  isMuted = false,
  isDeafened = false,
  isVideoOn = false,
  isScreenSharing = false,
  onJoinVoice = () => {},
  onDisconnect = () => {},
}: MockVoiceStageProps) {
  const isUserInThisVc = inVoiceRoom === currentChannel.id;
  const channelVoiceUsers = voiceUsers[currentChannel.id] || [];
  const otherVoiceUsers = channelVoiceUsers.filter(
    (u) => u.id !== currentUser.callsign && u.id !== currentUser.id
  );

  return (
    <div className="flex-1 flex flex-col bg-[#000000] p-6 items-center justify-center relative select-none">
      {/* Voice Stage Grid */}
      {isUserInThisVc ? (
        <div data-testid="voice-grid-active" className="grid grid-cols-2 gap-6 max-w-4xl w-full h-full max-h-[500px] items-center">
          <VoiceParticipantTile
            id={currentUser.callsign}
            name={currentUser.name}
            avatar={currentUser.avatar}
            isLocal={true}
            isSpeaking={Boolean(channelVoiceUsers.find(u => u.id === currentUser.callsign || u.id === currentUser.id)?.isSpeaking)}
            isMuted={isMuted}
            isDeafened={isDeafened}
            isVideoOn={isVideoOn}
            isScreenSharing={isScreenSharing}
          />

          {otherVoiceUsers.length === 0 ? (
            <div data-testid="solo-companion-card" className="bg-[#1e1322] rounded-[16px] p-6 text-center">
              <div className="text-5xl mb-4">🏆</div>
              <button><UserPlus className="w-3.5 h-3.5" /> Invite to Voice</button>
              <button><Sparkles className="w-3.5 h-3.5" /> Choose Activity</button>
            </div>
          ) : (
            otherVoiceUsers.map((vu) => (
              <VoiceParticipantTile
                key={vu.id}
                id={vu.id}
                name={vu.name}
                avatar={vu.avatar}
                isLocal={false}
                isSpeaking={Boolean(vu.isSpeaking)}
                isMuted={vu.isMuted}
                isDeafened={vu.isDeafened}
              />
            ))
          )}
        </div>
      ) : (
        otherVoiceUsers.length === 0 ? (
          <div data-testid="empty-lounge-card" className="flex flex-col items-center justify-center text-center p-8">
            <Volume2 className="w-8 h-8 text-[#00f0ff]" />
            <h3>{currentChannel.name} is quiet right now</h3>
            <p>No operatives are currently transmitting on this frequency. Connect to voice audio to start talking.</p>
            <button onClick={onJoinVoice}>Join Voice</button>
          </div>
        ) : (
          <div data-testid="voice-grid-viewing" className="grid grid-cols-2 gap-6 max-w-4xl w-full h-full max-h-[500px] items-center">
            {otherVoiceUsers.map((vu) => (
              <VoiceParticipantTile
                key={vu.id}
                id={vu.id}
                name={vu.name}
                avatar={vu.avatar}
                isLocal={false}
                isSpeaking={Boolean(vu.isSpeaking)}
                isMuted={vu.isMuted}
                isDeafened={vu.isDeafened}
              />
            ))}
          </div>
        )
      )}

      {/* Floating Bottom Bar */}
      {isUserInThisVc ? (
        <div data-testid="active-call-controls" className="absolute bottom-6 flex items-center gap-3">
          <button title={isMuted ? 'Unmute' : 'Mute'}>
            {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <button title={isDeafened ? 'Undeafen' : 'Deafen'}><Headphones className="w-4 h-4" /></button>
          <button title="Video"><Video className="w-4 h-4" /></button>
          <button title="Screen Share"><Monitor className="w-4 h-4" /></button>
          <button title="Disconnect" onClick={onDisconnect}><PhoneOff className="w-4 h-4" /></button>
        </div>
      ) : (
        <div data-testid="viewing-join-bar" className="absolute bottom-6 flex items-center gap-4">
          <span>You are viewing this channel without voice audio</span>
          <button onClick={onJoinVoice}>Join Voice</button>
        </div>
      )}
    </div>
  );
}

describe('Voice Channel Stage Participant Gating', () => {
  const currentChannel = { id: 'vc-bridge', name: 'Bridge Comm-Link', type: 'voice' as const };
  const currentUser = { id: 'user-self', callsign: 'picard', name: 'Jean-Luc Picard', avatar: '☕' };

  it('does NOT show a card for the user if they are not connected to the VC and room is empty', () => {
    render(
      <VoiceChannelStage
        currentChannel={currentChannel}
        currentUser={currentUser}
        inVoiceRoom={null}
        voiceUsers={{}}
      />
    );

    expect(screen.queryByText('Jean-Luc Picard')).not.toBeInTheDocument();
    expect(screen.queryByText('☕')).not.toBeInTheDocument();
    expect(screen.getByTestId('empty-lounge-card')).toBeInTheDocument();
    expect(screen.getByText('Bridge Comm-Link is quiet right now')).toBeInTheDocument();
    expect(screen.getByTestId('viewing-join-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('active-call-controls')).not.toBeInTheDocument();
    expect(screen.getByText('You are viewing this channel without voice audio')).toBeInTheDocument();
  });

  it('does NOT show a card for the user if they are not in the VC and others are in the VC', () => {
    const otherUsers: VoiceUser[] = [
      { id: 'user-riker', name: 'Will Riker', avatar: '🎺' },
      { id: 'user-data', name: 'Data', avatar: '🤖' },
    ];

    render(
      <VoiceChannelStage
        currentChannel={currentChannel}
        currentUser={currentUser}
        inVoiceRoom={null}
        voiceUsers={{ 'vc-bridge': otherUsers }}
      />
    );

    expect(screen.queryByText('Jean-Luc Picard')).not.toBeInTheDocument();
    expect(screen.getByText('Will Riker')).toBeInTheDocument();
    expect(screen.getByText('Data')).toBeInTheDocument();
    expect(screen.getByTestId('viewing-join-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('active-call-controls')).not.toBeInTheDocument();
  });

  it('shows card for user when they ARE in the VC alone', () => {
    render(
      <VoiceChannelStage
        currentChannel={currentChannel}
        currentUser={currentUser}
        inVoiceRoom="vc-bridge"
        voiceUsers={{}}
      />
    );

    expect(screen.getByText('Jean-Luc Picard')).toBeInTheDocument();
    expect(screen.getByText('☕')).toBeInTheDocument();
    expect(screen.getByTestId('solo-companion-card')).toBeInTheDocument();
    expect(screen.getByTestId('active-call-controls')).toBeInTheDocument();
    expect(screen.queryByTestId('viewing-join-bar')).not.toBeInTheDocument();
  });

  it('shows card for user and others when connected in a group call', () => {
    const activeUsers: VoiceUser[] = [
      { id: 'user-riker', name: 'Will Riker', avatar: '🎺' },
    ];

    render(
      <VoiceChannelStage
        currentChannel={currentChannel}
        currentUser={currentUser}
        inVoiceRoom="vc-bridge"
        voiceUsers={{ 'vc-bridge': activeUsers }}
      />
    );

    expect(screen.getByText('Jean-Luc Picard')).toBeInTheDocument();
    expect(screen.getByText('Will Riker')).toBeInTheDocument();
    expect(screen.getByTestId('active-call-controls')).toBeInTheDocument();
    expect(screen.getByTitle('Disconnect')).toBeInTheDocument();
  });
});
