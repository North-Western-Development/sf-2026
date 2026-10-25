// UI vocabulary. Every user-facing noun goes through here so the space terminology stays
// consistent (docs/terminology.md). `hint` is the familiar term, used in tooltips.

export const TERMS = {
  user: { one: 'Transmitter', many: 'Transmitters', hint: 'User' },
  message: { one: 'Transmission', many: 'Transmissions', hint: 'Message' },
  beacon: { one: 'Beacon', many: 'Beacons', hint: 'Server' },
  relay: { one: 'Relay', many: 'Relays', hint: 'Channel' },
  textRelay: { one: 'Text Relay', many: 'Text Relays', hint: 'Text channel' },
  commLink: { one: 'Comm-Link', many: 'Comm-Links', hint: 'Voice channel' },
  archival: { one: 'Archival Relay', many: 'Archival Relays', hint: 'Forum channel' },
  visual: { one: 'Visual Relay', many: 'Visual Relays', hint: 'Media channel' },
  band: { one: 'Frequency Band', many: 'Frequency Bands', hint: 'Category' },
  cluster: { one: 'Beacon Cluster', many: 'Beacon Clusters', hint: 'Server folder' },
  clearance: { one: 'Clearance', many: 'Clearances', hint: 'Role' },
  link: { one: 'Direct Link', many: 'Direct Links', hint: 'Direct message' },
  mesh: { one: 'Subspace Mesh', many: 'Subspace Meshes', hint: 'Group DM' },
  affiliate: { one: 'Affiliate', many: 'Affiliates', hint: 'Friend' },
  affiliationRequest: { one: 'Affiliation Request', many: 'Affiliation Requests', hint: 'Friend request' },
  transmissionRequest: { one: 'Transmission Request', many: 'Transmission Requests', hint: 'Message request' },
  glyph: { one: 'Signal Glyph', many: 'Signal Glyphs', hint: 'Custom emoji' },
  commendation: { one: 'Commendation', many: 'Commendations', hint: 'Badge' },
  vault: { one: 'Subspace Vault', many: 'Subspace Vault', hint: 'File storage' },
  console: { one: 'Command Console', many: 'Command Console', hint: 'Admin panel' },
  holoCast: { one: 'Holo-Cast', many: 'Holo-Casts', hint: 'Screen share' },
  ghost: { one: 'Ghost Mode', many: 'Ghost Mode', hint: 'Invisible' },
  thread: { one: 'Thread', many: 'Threads', hint: 'Thread' },
} as const;

export type TermKey = keyof typeof TERMS;
export const term = (k: TermKey, plural = false) => (plural ? TERMS[k].many : TERMS[k].one);

export const PRESENCE_LABELS: Record<string, { label: string; description?: string }> = {
  online: { label: 'Online' },
  idle: { label: 'Idle' },
  dnd: { label: 'Do Not Disturb', description: 'You will not receive desktop notifications' },
  invisible: { label: 'Invisible', description: 'You will appear offline (Ghost Mode)' },
  offline: { label: 'Offline' },
  away: { label: 'Away' },
};

export const relayKindLabel = (type: string) =>
  ({ text: TERMS.textRelay.one, comm_link: TERMS.commLink.one, stage: 'Stage', archival: TERMS.archival.one, visual: TERMS.visual.one, category: TERMS.band.one })[type] ??
  TERMS.relay.one;
