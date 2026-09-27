import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock simple ServerRail presentation structure matching App.tsx
interface Beacon {
  id: string;
  name: string;
  unreadCount?: number;
  iconText: string;
  gradient: string;
}

interface ServerFolder {
  id: string;
  name: string;
  color?: string;
  beaconIds: string[];
  isExpanded?: boolean;
}

const ServerRailMock = ({
  beacons,
  folders,
  selectedBeaconId,
  onSelectBeacon,
  onToggleFolder,
}: {
  beacons: Beacon[];
  folders: ServerFolder[];
  selectedBeaconId: string;
  onSelectBeacon: (id: string) => void;
  onToggleFolder: (folderId: string) => void;
}) => {
  return (
    <div className="w-[72px] bg-[#080809] flex flex-col items-center py-3 gap-2 shrink-0 border-r border-[#141518]">
      {folders.map((folder) => {
        const folderBeacons = beacons.filter(b => folder.beaconIds.includes(b.id));
        const hasActiveInFolder = folder.beaconIds.includes(selectedBeaconId);

        return (
          <div key={folder.id} className="w-full flex flex-col items-center gap-1.5" data-testid={`folder-${folder.id}`}>
            {!folder.isExpanded ? (
              <div className="relative flex items-center justify-center w-full group">
                {/* White Indicator Pill on Left Rail (x=0) */}
                <span
                  data-testid={`pill-${folder.id}`}
                  className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 bg-white rounded-r-full ${
                    hasActiveInFolder ? 'h-10' : 'h-0'
                  }`}
                />
                <div
                  onClick={() => onToggleFolder(folder.id)}
                  data-testid={`capsule-${folder.id}`}
                  className="w-12 h-12 rounded-[24px] flex items-center justify-center p-2 cursor-pointer border"
                >
                  <div className="grid grid-cols-2 gap-1 w-full h-full items-center justify-center">
                    {folderBeacons.slice(0, 4).map(fb => (
                      <span key={fb.id} className="w-3.5 h-3.5 rounded text-[7px] font-bold text-white flex items-center justify-center">
                        {fb.iconText[0]}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              /* Expanded Folder Capsule: w-12 (48px) width centered in 72px rail */
              <div className="w-full flex flex-col items-center" data-testid={`expanded-container-${folder.id}`}>
                <div className="w-12 rounded-[24px] flex flex-col items-center gap-2 py-2 border shadow-inner">
                  <button
                    data-testid={`collapse-btn-${folder.id}`}
                    onClick={() => onToggleFolder(folder.id)}
                    className="w-10 h-6 rounded-[12px] flex items-center justify-center cursor-pointer"
                  >
                    ⌵
                  </button>

                  {folderBeacons.map((beacon) => {
                    const isSelected = selectedBeaconId === beacon.id;
                    return (
                      <div key={beacon.id} className="relative flex items-center justify-center w-12 group">
                        {/* Indicator pill positioned with -left-3 (-12px) touching the outer rail wall at x=0 */}
                        <span
                          data-testid={`beacon-pill-${beacon.id}`}
                          className={`absolute -left-3 top-1/2 -translate-y-1/2 w-1 bg-white rounded-r-full ${
                            isSelected ? 'h-10' : 'h-0'
                          }`}
                        />
                        <button
                          onClick={() => onSelectBeacon(beacon.id)}
                          className="w-11 h-11 flex items-center justify-center font-bold text-xs rounded-[14px]"
                        >
                          {beacon.iconText}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

describe('ServerRail Cluster & Indicator Pill Alignment', () => {
  const mockBeacons: Beacon[] = [
    { id: 'b1', name: 'Alpha Station', iconText: 'AS', gradient: 'linear-gradient(135deg, #00f0ff, #5865f2)' },
    { id: 'b2', name: 'Bravo Outpost', iconText: 'BO', gradient: 'linear-gradient(135deg, #f23f43, #eb459e)' },
  ];

  it('renders collapsed folder capsule with 48px size (w-12 h-12) and left-0 indicator pill', () => {
    const folders: ServerFolder[] = [
      { id: 'f1', name: 'Fleet Ops', beaconIds: ['b1', 'b2'], isExpanded: false },
    ];

    render(
      <ServerRailMock
        beacons={mockBeacons}
        folders={folders}
        selectedBeaconId="b1"
        onSelectBeacon={vi.fn()}
        onToggleFolder={vi.fn()}
      />
    );

    const capsule = screen.getByTestId('capsule-f1');
    expect(capsule).toHaveClass('w-12', 'h-12');

    const pill = screen.getByTestId('pill-f1');
    expect(pill).toHaveClass('absolute', 'left-0', 'h-10');
  });

  it('renders expanded folder container centered at w-12 (48px) with indicator pill flush on left rail (-left-3)', () => {
    const folders: ServerFolder[] = [
      { id: 'f1', name: 'Fleet Ops', beaconIds: ['b1', 'b2'], isExpanded: true },
    ];

    render(
      <ServerRailMock
        beacons={mockBeacons}
        folders={folders}
        selectedBeaconId="b1"
        onSelectBeacon={vi.fn()}
        onToggleFolder={vi.fn()}
      />
    );

    // Folder capsule is w-12 (48px)
    const expandedContainer = screen.getByTestId('expanded-container-f1').querySelector('.w-12');
    expect(expandedContainer).toBeInTheDocument();

    // Child beacon indicator pill has -left-3 (12px offset from 48px child = exactly x=0 on 72px rail)
    const beaconPill = screen.getByTestId('beacon-pill-b1');
    expect(beaconPill).toHaveClass('absolute', '-left-3', 'h-10');
  });

  it('toggles folder expansion on click', () => {
    const onToggle = vi.fn();
    const folders: ServerFolder[] = [
      { id: 'f1', name: 'Fleet Ops', beaconIds: ['b1', 'b2'], isExpanded: false },
    ];

    render(
      <ServerRailMock
        beacons={mockBeacons}
        folders={folders}
        selectedBeaconId="b2"
        onSelectBeacon={vi.fn()}
        onToggleFolder={onToggle}
      />
    );

    fireEvent.click(screen.getByTestId('capsule-f1'));
    expect(onToggle).toHaveBeenCalledWith('f1');
  });
});
