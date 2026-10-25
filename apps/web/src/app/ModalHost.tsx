import { useNavigate } from 'react-router';
import { useStore } from '../data/store';
import { useUi, closeModal } from './ui';
import { ConfirmModal, PromptModal } from '../features/modals/SimpleModals';
import { CreateBandModal, CreateBeaconModal, CreateMeshModal, CreateRelayModal, InviteModal } from '../features/modals/CreateModals';
import { QuickScanModal } from '../features/modals/QuickScanModal';
import { NotificationSettingsModal } from '../features/modals/NotificationSettingsModal';
import { ProfileModal } from '../features/profile/ProfilePopout';
import { BadgesModal } from '../features/profile/BadgesModal';
import { StatusModal } from '../features/user/StatusModal';
import { UserSettings } from '../features/settings/UserSettings';
import { BeaconSettings } from '../features/settings/BeaconSettings';
import { VaultModal } from '../features/vault/VaultModal';
import { DriveBrowser } from '../features/vault/DriveBrowser';
import { Modal } from '@subspace/ui';
import { ConsoleModal } from '../features/console/ConsoleModal';
import { ReportModal } from '../features/modals/ReportModal';

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
      content = <VaultModal onClose={closeModal} />;
      break;
    case 'drivePicker': {
      const { onPick } = modal;
      content = (
        <Modal isOpen onClose={closeModal} title="Attach from Cloud Drive" description="The file is copied into your vault, then attached." maxWidth="2xl">
          <DriveBrowser
            actionLabel="Attach"
            onImported={(file) => {
              onPick(file);
              closeModal();
            }}
          />
        </Modal>
      );
      break;
    }
    case 'status':
      content = <StatusModal />;
      break;
    case 'badges':
      content = <BadgesModal />;
      break;
    case 'console':
      content = <ConsoleModal staffRank={staffRank} />;
      break;
    case 'report': {
      const label = modal.targetType === 'transmitter' ? users[modal.targetId]?.username ?? 'Transmitter' : modal.targetType === 'beacon' ? 'Beacon' : 'Transmission';
      content = <ReportModal onClose={closeModal} targetType={modal.targetType} targetId={modal.targetId} targetLabel={label} />;
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
