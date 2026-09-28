import { useNavigate } from 'react-router';
import { useStore } from '../data/store';
import { useUi, closeModal } from './ui';
import { ConfirmModal, PromptModal } from '../features/modals/SimpleModals';
import { CreateBandModal, CreateBeaconModal, CreateMeshModal, CreateRelayModal, InviteModal } from '../features/modals/CreateModals';
import { QuickScanModal } from '../features/modals/QuickScanModal';
import { NotificationSettingsModal } from '../features/modals/NotificationSettingsModal';
import { ProfileModal } from '../features/profile/ProfilePopout';
import { UserSettings } from '../features/settings/UserSettings';
import { BeaconSettings } from '../features/settings/BeaconSettings';
import { SubspaceVaultModal } from '../SubspaceVaultModal';
import { CommandConsoleModal } from '../CommandConsoleModal';
import { IncidentFlareModal } from '../IncidentFlareModal';

/** Renders the active modal (single slot) and any confirm/prompt dialog stacked above it. */
export function ModalHost() {
  const modal = useUi((s) => s.modal);
  const dialog = useUi((s) => s.dialog);
  const staffRank = useStore((s) => s.me?.staffRank ?? 0);
  const users = useStore((s) => s.users);
  const navigate = useNavigate();

  let content: React.ReactNode = null;
  switch (modal?.kind) {
    case 'userSettings':
      content = <UserSettings tab={modal.tab} />;
      break;
    case 'beaconSettings':
      content = <BeaconSettings beaconId={modal.beaconId} tab={modal.tab} />;
      break;
    case 'createBeacon':
      content = <CreateBeaconModal />;
      break;
    case 'createRelay':
      content = <CreateRelayModal beaconId={modal.beaconId} parentId={modal.parentId} type={modal.type} />;
      break;
    case 'createBand':
      content = <CreateBandModal beaconId={modal.beaconId} />;
      break;
    case 'invite':
      content = <InviteModal beaconId={modal.beaconId} relayId={modal.relayId} />;
      break;
    case 'profile':
      content = <ProfileModal userId={modal.userId} beaconId={modal.beaconId} />;
      break;
    case 'notificationSettings':
      content = <NotificationSettingsModal beaconId={modal.beaconId} />;
      break;
    case 'createMesh':
      content = <CreateMeshModal />;
      break;
    case 'addAffiliate':
      closeModal();
      navigate('/channels/@me');
      break;
    case 'quickScan':
      content = <QuickScanModal />;
      break;
    case 'vault':
      content = <SubspaceVaultModal isOpen onClose={closeModal} />;
      break;
    case 'console':
      content = <CommandConsoleModal isOpen onClose={closeModal} staffRank={staffRank} />;
      break;
    case 'report': {
      const label = modal.targetType === 'transmitter' ? users[modal.targetId]?.username ?? 'Transmitter' : modal.targetType === 'beacon' ? 'Beacon' : 'Transmission';
      content = <IncidentFlareModal isOpen onClose={closeModal} targetType={modal.targetType} targetId={modal.targetId} targetLabel={label} />;
      break;
    }
    default:
      content = null;
  }

  return (
    <>
      {content}
      {dialog?.kind === 'confirm' && <ConfirmModal {...dialog} />}
      {dialog?.kind === 'prompt' && <PromptModal {...dialog} />}
    </>
  );
}
