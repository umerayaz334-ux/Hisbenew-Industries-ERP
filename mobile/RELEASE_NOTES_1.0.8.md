# Hisbenew ERP Android 1.0.8 (4007)

## Changes

- Reworked internal call audio to use the authenticated API voice relay and native Android microphone/audio handling.
- Improved incoming call notification actions, ringtone ownership, call controls, microphone permission handling, reconnect feedback, and small-screen call layout.
- Improved order and message notification event handling and message previews.
- Kept the Android package compatible with arm64 and 32-bit ARM devices while removing the old WebRTC `libjingle` native library.
- Added a warehouse handoff share action in the portal with the order, customer, items and quantities, note, and shipping label when file sharing is supported.

## Verification and requirements

- Flutter tests: 23 passed.
- Backend voice-relay tests: 2 passed.
- Flutter release APK build completed; package version is 1.0.8 (4007), minimum Android API 24.
- Portal production build completed.
- The voice-relay backend route must be deployed with this version. Call audio and lock-screen actions still require tests on physical phones and separate networks.
- Background FCM delivery depends on matching Firebase Android and server configuration. Firebase configuration was not present in this checkout, so closed-app notification delivery is not verified by this release build.
