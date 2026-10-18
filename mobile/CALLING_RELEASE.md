# Android test release — 18 October 2026

Website: https://app.hisbenew.com. Mobile API: https://api.hisbenew.com.
Worker and admin remain in one app with server-controlled page access.

## Included changes

- Worker dashboard: every pending dispatch in a carousel, compact actions, shared shipping/order summaries, no fixed bell/header row.
- Menu opens a sidebar. Account and Settings are separate destinations; Notifications are in the drawer.
- Manufacturing aggregates pending demand against stock, excluding shipped, cancelled and other-company orders.
- Product photos persist in application support storage after download. Settings can clear images without deleting pending jobs.
- Spending/messages keep request IDs until server confirmation. Rejected entries show reasons without blocking other valid jobs. Older servers cannot consume queued entries without idempotency support.
- Calls wait for ICE configuration, initialize WebRTC before audio settings, retain unsent ICE candidates and retry unacknowledged answers. Ending the call service resets audio mode.
- Incoming calls use the default phone ringtone and native notification. System ringtone volume, silent mode and DND apply. Settings includes a ringtone preview.
- Message notifications show sender names and up to five unread previews, subject to phone lock-screen privacy settings.

## APKs and verification

Build number 10. ARM64 suits most recent phones; ARMv7 suits 32-bit Android installations; x86_64 suits compatible emulators/devices. Compatibility depends on Android version and CPU rather than brand.

Verified minimum Android version: Android 7 (API 24); target API 36. The universal APK includes all three architectures and is larger. Flutter assigns version codes 1010/2010/3010 to the split APKs and 10 to universal; continue updating with the same variant. If Android refuses an update, keep the installed app and its queued jobs intact rather than uninstalling.

```powershell
flutter analyze --no-pub
flutter test --no-pub
flutter build apk --release --no-pub --split-per-abi --build-number=10
```

The release build uses the existing debug signing key and is for testing. Update in place: uninstalling or clearing app data deletes unsynced jobs. Windows tests use SDK junction D:\DevCache\tmp\hisbenew-flutter-sdk because native hooks fail with spaces in the SDK path.

## Required deployment and configuration

The live API checked during this work lacked the sync capability endpoint, message preview schema and manufacturing endpoint. Deploy this backend before testing those features. Verify OpenAPI includes /worker-expenses/sync-capabilities, /manufacturing/dispatch-needs and InternalMessageUserOut.unread_messages. The authenticated capability response must include idempotent_expenses and idempotent_messages, both true. Retry pending jobs under the same account; do not recreate them manually.

Firebase client/server integration exists, but this checkout has no Firebase Android configuration. Reliable background push is not activated in this test APK:

1. Register package com.hisbenew.factory.hisbenew_erp in the owner's Firebase project.
2. Place its Android configuration at mobile/android/app/google-services.json and rebuild.
3. Set GOOGLE_APPLICATION_CREDENTIALS on the deployed backend to a protected server-side service-account file from that same Firebase project. Never package the credential in the APK or commit it.
4. Sign in again and verify device registration plus foreground/background/locked-phone delivery.

Configure a maintained TURN relay in backend environment variable INTERNAL_CALL_ICE_SERVERS (JSON list with urls, username, credential). Public fallback servers do not guarantee production call reliability. Test two-way audio across different mobile networks.

GitHub access works outside the network sandbox. The Windows VPS deployment runner was verified online. Server inspection confirmed Firebase credentials and dedicated ICE/TURN configuration are absent. Deployment now backs up SQLite data and source, preserves server configuration, and restarts only the verified ERP backend process.

## Physical phone acceptance checks

- Update in place, reconnect and retry the three saved jobs. Confirm each appears exactly once for admin.
- Browse products online and let photos download; restart offline and check products, orders and photos. Save spending offline, reconnect and check admin receipt.
- Test mobile/mobile and web/mobile calls: open, home-screen and locked answers, two-way audio, decline/cancel on both sides, quick repeat calls, microphone permissions, speaker and headset.
- Verify message previews with lock-screen content enabled, revoked worker pages and read-only worker shipping.
- Compare manufacturing quantities to a known shared-stock shortage.

No physical phone was connected. The native crash trace alone does not identify the exact assertion; if it recurs, capture logcat including lines before Fatal signal.

Android restricts full-screen notifications; force-stopped apps need reopening before FCM resumes. References: [Firebase delivery](https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages), [Android full-screen intent restrictions](https://developer.android.com/about/versions/14/behavior-changes-14).
