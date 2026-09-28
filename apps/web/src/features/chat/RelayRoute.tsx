import { Navigate, useParams } from 'react-router';
import { useStore } from '../../data/store';
import { channelKey } from '../../lib/types';
import { relayPermissions, can, PERMISSIONS } from '../../data/permissions';
import { ChannelView } from './ChannelView';
import { RelayIcon } from '../sidebar/BeaconSidebar';
import { CommLinkView } from '../voice/CommLinkView';
import { ForumView } from '../forum/ForumView';
import { VisualGalleryView } from '../../VisualGalleryView';

export function RelayRoute() {
  const { beaconId = '', relayId = '' } = useParams();
  const relay = useStore((s) => s.relays[relayId]);
  const loaded = useStore((s) => !!s.relayIdsByBeacon[beaconId]);
  const beacon = useStore((s) => s.beacons[beaconId]);
  const canView = useStore((s) => can(relayPermissions(s, relayId), PERMISSIONS.VIEW_RELAY));

  if (!loaded) return null;
  if (!relay || relay.beaconId !== beaconId || relay.type === 'category' || !canView) {
    return <Navigate to={`/channels/${beaconId}`} replace />;
  }

  if (relay.type === 'comm_link') return <CommLinkView relay={relay} />;
  if (relay.type === 'archival') return <ForumView relay={relay} key={relay.id} />;
  if (relay.type === 'visual') return <VisualGalleryView relayId={relay.id} relayName={relay.name} key={relay.id} />;

  return (
    <ChannelView
      key={relay.id}
      channelKey={channelKey('relay', relay.id)}
      beaconId={beaconId}
      icon={<RelayIcon type={relay.type} className="h-6 w-6" />}
      title={relay.name}
      topic={relay.topic}
      placeholder={`Transmit to #${relay.name}`}
      welcome={
        <div className="mx-4 mb-4 mt-16">
          <span className="mb-2 flex h-[68px] w-[68px] items-center justify-center rounded-full bg-overlay">
            <RelayIcon type={relay.type} className="h-10 w-10 text-fg" />
          </span>
          <h2 className="text-[32px] font-bold leading-tight text-fg">Welcome to #{relay.name}!</h2>
          <p className="text-fg-muted">This is the start of the #{relay.name} relay{beacon ? ` in ${beacon.name}` : ''}.</p>
        </div>
      }
    />
  );
}
