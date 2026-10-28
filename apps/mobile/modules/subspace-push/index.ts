import { requireOptionalNativeModule } from 'expo';

type EventSubscription = { remove(): void };

export interface UnifiedPushEndpoint {
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface SubspacePushModule {
  distributors(): string[];
  register(): Promise<'registering' | 'no-distributor'>;
  endpoint(): UnifiedPushEndpoint | null;
  notify(title: string, body: string, path: string | null): void;
  takeLaunchPath(): string | null;
  addListener(event: 'onEndpoint', listener: (e: { endpoint: UnifiedPushEndpoint | null }) => void): EventSubscription;
  addListener(event: 'onOpen', listener: (e: { path: string }) => void): EventSubscription;
}

/** The Android module (UnifiedPush and notifications); null on iOS, which uses expo-notifications. */
export const SubspacePush = requireOptionalNativeModule<SubspacePushModule>('SubspacePush');
