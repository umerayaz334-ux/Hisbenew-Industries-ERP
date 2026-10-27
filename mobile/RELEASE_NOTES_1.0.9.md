# Hisbenew ERP Android 1.0.9 (4008)

## Changes

- Reduce voice-call latency by shortening browser capture blocks and Android playback buffering.
- Enable browser microphone noise suppression and use anti-aliased resampling for clearer voice.
- Bound browser playout scheduling and Android playback backlog to prevent delay from accumulating.
- Remove Android automatic gain control that could amplify room hiss on supported devices.

## Verification

- The Flutter test suite passed in the hosted Android release build, including call-screen sizing, worker navigation, offline sync, and offline product photos.
- Portal production build and call-delivery backend tests passed.
- Universal Android APK verified as version 1.0.9, build 4008; package alignment and APK signatures passed.
- Signed with the same installation certificate as 1.0.8 so existing installations can update.
- Real-device call quality still needs confirmation on the worker phone and portal browser.
