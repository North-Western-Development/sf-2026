import { create } from 'zustand';
import { http, optional } from '../../lib/http';
import { toast } from '../../app/ui';
import { getState } from '../../data/store';
import { rtcManager } from '../../services/rtc';
import { rejoinMedia, useVoice } from './session';

export interface StageState {
  topic: string | null;
  startedAt: string | null;
  startedBy: string | null;
  speakers: string[];
  requests: string[];
}

interface StageStore {
  byRelay: Record<string, StageState>;
  /** Whether I moderate each stage (Manage Relays, Mute or Move Members). */
  moderator: Record<string, boolean>;
}

export const useStages = create<StageStore>()(() => ({ byRelay: {}, moderator: {} }));
export const EMPTY_STAGE: StageState = { topic: null, startedAt: null, startedBy: null, speakers: [], requests: [] };

/** Publish or stop publishing to match whether I speak on the stage I am in. */
function syncMyRole(relayId: string) {
  const me = getState().me?.id;
  const v = useVoice.getState();
  if (!me || v.relayId !== relayId || v.state === 'idle') return;
  const speaking = (useStages.getState().byRelay[relayId] ?? EMPTY_STAGE).speakers.includes(me);
  // Rejoin with a token for the new role when it no longer matches what we publish.
  if (speaking !== !!rtcManager.getLocalAudioTrack()) void rejoinMedia();
}

function apply(relayId: string, stage: StageState, moderator?: boolean) {
  useStages.setState((s) => ({
    byRelay: { ...s.byRelay, [relayId]: stage },
    moderator: moderator === undefined ? s.moderator : { ...s.moderator, [relayId]: moderator },
  }));
  syncMyRole(relayId);
}

export async function loadStage(relayId: string) {
  const res = await optional(http.get<{ stage: StageState; moderator: boolean }>(`/relays/${relayId}/stage`), null);
  if (res) apply(relayId, res.stage, res.moderator);
}

const run = async (p: Promise<{ stage: StageState }>, relayId: string) => {
  try {
    apply(relayId, (await p).stage);
  } catch (err) {
    toast((err as Error).message, 'error');
  }
};

export const startStage = (relayId: string, topic: string) => run(http.post(`/relays/${relayId}/stage`, { topic }), relayId);
export const setStageTopic = (relayId: string, topic: string) => run(http.patch(`/relays/${relayId}/stage`, { topic }), relayId);
export const endStage = (relayId: string) => run(http.delete(`/relays/${relayId}/stage`), relayId);
export const raiseHand = (relayId: string, raised: boolean) => run(http.post(`/relays/${relayId}/stage/hand`, { raised }), relayId);
export const inviteToSpeak = (relayId: string, userId: string) => run(http.put(`/relays/${relayId}/stage/speakers/${userId}`), relayId);
export const moveToAudience = (relayId: string, userId: string) => run(http.delete(`/relays/${relayId}/stage/speakers/${userId}`), relayId);

/** STAGE_UPDATE: a stage I can see started, ended, or changed speakers. */
export function onStageUpdate(d: { relayId: string; stage: StageState }) {
  apply(d.relayId, d.stage);
}

// Joining a stage that is already live: catch up on who speaks.
useVoice.subscribe((v, prev) => {
  if (v.relayId && v.state === 'connected' && (prev.relayId !== v.relayId || prev.state !== 'connected') && getState().relays[v.relayId]?.type === 'stage') {
    void loadStage(v.relayId);
  }
});
