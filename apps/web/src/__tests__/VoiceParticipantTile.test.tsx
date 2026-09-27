import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VoiceParticipantTile } from '../components/VoiceParticipantTile';

describe('VoiceParticipantTile WebRTC Component', () => {
  it('renders avatar and name for participant without active video', () => {
    render(
      <VoiceParticipantTile
        id="user-1"
        name="Commander Data"
        avatar="🤖"
      />
    );

    expect(screen.getByText('Commander Data')).toBeInTheDocument();
    expect(screen.getByText('🤖')).toBeInTheDocument();
  });

  it('renders speaking indicator ring when isSpeaking is true', () => {
    const { container } = render(
      <VoiceParticipantTile
        id="user-2"
        name="Lt. Worf"
        avatar="⚔️"
        isSpeaking={true}
      />
    );

    expect(container.querySelector('.ring-4.ring-\\[\\#23a55a\\]')).toBeInTheDocument();
  });

  it('renders optical video element when isVideoOn is true', () => {
    const { container } = render(
      <VoiceParticipantTile
        id="user-3"
        name="Geordi La Forge"
        avatar="👓"
        isLocal={true}
        isVideoOn={true}
      />
    );

    const videoEl = container.querySelector('video');
    expect(videoEl).toBeInTheDocument();
    expect(screen.getByText('Optical Feed')).toBeInTheDocument();
  });

  it('renders Holo-Cast stream badge when isScreenSharing is true', () => {
    render(
      <VoiceParticipantTile
        id="user-4"
        name="Chief O'Brien"
        avatar="🔧"
        isLocal={true}
        isScreenSharing={true}
      />
    );

    expect(screen.getByText('Holo-Cast Stream')).toBeInTheDocument();
  });

  it('renders mute and deafen status icons', () => {
    render(
      <VoiceParticipantTile
        id="user-5"
        name="Counselor Troi"
        avatar="✨"
        isMuted={true}
        isDeafened={true}
      />
    );

    expect(screen.getByTitle('Deafened')).toBeInTheDocument();
  });
});
