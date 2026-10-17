# Android calling and messaging test release

ERP website: https://app.hisbenew.com. Backend: https://api.hisbenew.com.
Changing the website hostname does not change the mobile API hostname.

## Changes

- Direct coworker conversations with no contact-request approval. Active accounts remain scoped to their company; visitors are excluded.
- Native incoming-call screen with a bundled repeating Hisbenew double chime. Ring volume, silent mode and DND remain controlled by Android.
- Native decline, delayed activity resume after Answer, duplicate answers, connecting/connected state, duration, mute, speaker and serialized media cleanup.
- Android network-state permission and a microphone foreground service for ongoing calls after switching apps.
- Account settings expose microphone permission recovery, notification settings and sound settings.
- Notification bell/inbox show unread messages and worker dispatch reminders. These are live actionable alerts, not historical notifications.

## Build and checks

```powershell
flutter analyze --no-pub
flutter test --no-pub
flutter build apk --release --no-pub --build-number=2
```

Windows native test hooks fail when the SDK executable path has spaces. Tests use a temporary SDK junction without spaces at `D:\DevCache\tmp\hisbenew-flutter-sdk`, without moving the SDK. For stalled Maven metadata lookups, use cached dependencies:

```powershell
cd android
.\gradlew.bat --offline --console=plain assembleRelease '-Ptarget-platform=android-arm64' '-Ptarget=lib/main.dart'
```

The arm64 APK is for the Redmi test device. The project retains its existing debug signing configuration for release builds; production distribution needs a maintained signing key. Regenerate the original ringtone with `python tool/generate_ringtone.py`.

## Deployment and device verification

Deploy backend and web changes together with this APK. The API must expose all eligible coworkers and accept repeated call actions. Message history and legacy request records are retained; obsolete request-creation/review routes return 410.

Test on two phones and between mobile and web:

1. Call from the Redmi with microphone permission initially granted and initially denied.
2. Ring and answer with the app visible, on the home screen, and locked. Confirm two-way audio.
3. Decline from both native and in-app screens; confirm the caller stops ringing. Cancel from the caller before answering.
4. End/repeat calls quickly, toggle mute/speaker, switch apps during a call, and switch Wi-Fi/mobile data.
5. Verify ringtone stops after answer/decline/timeout, permission settings open, and the bell reflects unread messages.
6. Verify cross-company, disabled and visitor accounts do not appear as recipients.

The supplied Redmi trace identifies a native WebRTC abort but lacks the preceding Java exception/WebRTC assertion. ACCESS_NETWORK_STATE was missing and is now declared; hardware verification is required. If it crashes, capture `adb logcat -b all -v threadtime`, including lines before `Fatal signal`.

## Remaining infrastructure

Incoming discovery still uses a background service; calls poll independently every two seconds. Android battery management or process termination can stop it. The data-sync service no longer starts at boot because newer Android versions restrict that service type at boot. Reliable waking after process termination needs high-priority push delivery (e.g. Firebase Cloud Messaging), project configuration, and a server sender. Android force-stop is not guaranteed reachable. A dedicated TURN service is needed for production network coverage. This test APK does not claim those infrastructure capabilities.
