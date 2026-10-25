import { create } from 'zustand';

/**
 * Discord's sensitive-media filter, done on this device: images are checked by a small image
 * classifier (nsfwjs, loaded only when a filter is on) and explicit ones are blurred until
 * clicked. Nothing is uploaded anywhere to be checked.
 */
export type MediaAction = 'show' | 'blur';
export interface ExplicitPrefs {
  /** Direct links and meshes with affiliates. */
  dmFriends: MediaAction;
  /** Direct links and meshes with everyone else. */
  dmOthers: MediaAction;
  /** Relays in beacons (a beacon's own filter can also turn this on). */
  beacons: MediaAction;
}

const KEY = 'subspace_explicit_prefs';
const defaults: ExplicitPrefs = { dmFriends: 'show', dmOthers: 'blur', beacons: 'show' };
const read = (): ExplicitPrefs => {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return defaults;
  }
};
export const useExplicitPrefs = create<ExplicitPrefs>()(read);
export function setExplicitPrefs(patch: Partial<ExplicitPrefs>) {
  useExplicitPrefs.setState(patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(useExplicitPrefs.getState()));
  } catch {
    /* storage unavailable */
  }
}

/** Whether images in a transmission should be checked, from where it is and who sent it. */
export function shouldFilter(opts: {
  prefs: ExplicitPrefs;
  channelType: string;
  mine: boolean;
  authorIsFriend: boolean;
  beaconFilter?: 'off' | 'members' | 'all';
  authorHasClearance?: boolean;
}): boolean {
  if (opts.mine) return false;
  if (opts.channelType === 'link' || opts.channelType === 'mesh') return (opts.authorIsFriend ? opts.prefs.dmFriends : opts.prefs.dmOthers) === 'blur';
  if (opts.beaconFilter === 'all' || (opts.beaconFilter === 'members' && !opts.authorHasClearance)) return true;
  return opts.prefs.beacons === 'blur';
}

type Model = { classify: (img: HTMLImageElement) => Promise<Array<{ className: string; probability: number }>> };
let model: Promise<Model> | null = null;
const results = new Map<string, Promise<boolean>>();

async function loadModel(): Promise<Model> {
  const [tf, core, mobilenet] = await Promise.all([import('@tensorflow/tfjs'), import('nsfwjs/core'), import('nsfwjs/models/mobilenet_v2')]);
  await tf.ready();
  return (await core.load('MobileNetV2', { modelDefinitions: [mobilenet.MobileNetV2Model] })) as unknown as Model;
}

/** Explicit when the classifier is fairly sure an image is porn or hentai. */
export const isExplicitPrediction = (p: Array<{ className: string; probability: number }>) =>
  p.filter((x) => x.className === 'Porn' || x.className === 'Hentai').reduce((sum, x) => sum + x.probability, 0) > 0.6;

/** Checks an image (cached by URL). Tests can stand in a classifier with window.__subspaceClassify. */
export function checkImage(url: string): Promise<boolean> {
  const cached = results.get(url);
  if (cached) return cached;
  const job = (async () => {
    const override = (window as any).__subspaceClassify as ((url: string) => boolean | Promise<boolean>) | undefined;
    if (override) return override(url);
    const m = await (model ??= loadModel());
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await img.decode();
    return isExplicitPrediction(await m.classify(img));
  })().catch(() => false);
  results.set(url, job);
  return job;
}
