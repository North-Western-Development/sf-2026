# Mobile push

The mobile app registers an Expo push token once someone signs in. The API pushes:

- every transmission in direct links and meshes;
- mentions in beacons;
- incoming calls.

Nobody gets a push for:

- conversations or beacons they muted, or with mobile push turned off;
- anything while they are in Do Not Disturb;
- their own transmissions.

Encrypted conversations push only "Sent an encrypted transmission", because the server cannot read them. Tokens Expo reports as no longer registered are deleted.

## Setup

1. Create an Expo project for your build of `apps/mobile` (`eas init`); this sets `extra.eas.projectId` in `app.json`.
2. Configure credentials for the stores (`eas credentials`): APNs for iOS, FCM for Android.
3. If you turn on **enhanced push security** for the project, set `EXPO_ACCESS_TOKEN` in `.env`.

Pushes are sent to `https://exp.host/--/api/v2/push/send` (override with `EXPO_PUSH_URL`, which the tests use).
