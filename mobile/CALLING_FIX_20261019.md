# Calling repair checkpoint — 19 October 2026

Test APK target: Android 1.0.8, build 4007. This is a repair/test build, not a claim of verified production calling.

## Changes
- Wait for the Android microphone foreground service to acknowledge successful startup. Surface permission/startup errors instead of silently proceeding without audio.
- Wait for the Activity to resume after microphone permission dialogs. Release a pending permission response if the Activity is destroyed.
- Ignore duplicate Answer events for an outgoing/connected call. Serialize ICE recovery with SDP processing and cleanup, reset the connection timeout after Answer, and show a useful network/relay failure reason.
- Preserve authenticated TURN configurations; only discard the retired public OpenRelay credentials.
- Use the native call notification and its lock-screen full-screen intent instead of directly launching repeated incoming-call Activities. One background watcher presents the notification; FCM delegates to it while it is running. Native notification audio is the sole incoming ringtone owner.
- Restart outgoing ringback after media preparation without taking audio focus away from WebRTC. Stop ringback on Answer/connection/end.
- Order alerts explicitly allow lock-screen text, sound and vibration. FCM handles order events. Backend wakes active workers with Orders access in the same tenant after Office/CSV/Muse order creation completes.

## Validation
22 Flutter tests pass, including duplicate call-screen/Answer regressions and TURN filtering. 11 focused backend tests pass, including tenant/access filtering for order wake-ups.
Full Flutter analysis on the clean source copy has two pre-existing warnings: unused shipping _loading field and unused worker portal loader import. The changed calling files passed targeted analysis before the final notification-owner changes; all final Dart changes compile in the tests.
The build copy is exported from the tracked baseline with only these calling/notification edits overlaid. Unfinished warehouse navigation and an unconnected raw-PCM voice prototype in the shared workspace are preserved and excluded.
The local Android/Dart files of flutter_callkit_incoming 3.1.6 match the published package archive.

## Still required
- Physical phone verification: Android microphone denial/allow, lock-screen Answer/Decline, only one incoming call screen, incoming tone, outgoing ringback, speaker/earpiece and two-way audio on separate networks.
- A reachable authenticated TURN relay. A fresh external TCP connection to api.hisbenew.com:3478 timed out. This does not establish UDP availability, and production relay operation remains unverified. The existing server installer needs Administrator access to configure its firewall/service.
- Firebase client configuration at mobile/android/app/google-services.json and matching server credentials. Neither is bundled in this repair. Polling cannot guarantee closed-app/locked-device delivery across Android restrictions.
- Keep unsynced phone work intact. Verify APK signing compatibility before recommending an update or replacing the portal download. Never uninstall a phone with unsynced jobs merely to make an APK install.
