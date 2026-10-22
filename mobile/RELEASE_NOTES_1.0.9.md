# Hisbenew ERP Android 1.0.9 (4008)

## Changes

- Reduce voice-call latency by shortening browser capture blocks and Android playback buffering.
- Enable browser microphone noise suppression and use anti-aliased resampling for clearer voice.
- Bound browser playout scheduling and Android playback backlog to prevent delay from accumulating.
- Remove Android automatic gain control that could amplify room hiss on supported devices.

## Verification

- All 23 Flutter tests passed, including call-screen sizing, worker navigation, offline sync, and offline product photos.
- Portal production build and call-delivery backend tests passed.
- Android release packaging did not complete in this session, so this note does not certify an installable APK.
- Real-device call quality still needs confirmation on the worker phone and portal browser.
