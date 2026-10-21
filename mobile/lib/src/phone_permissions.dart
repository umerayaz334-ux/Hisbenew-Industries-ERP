import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class PhonePermissions {
  static const _channel = MethodChannel('hisbenew/phone');
  static const _voiceFramesChannel = EventChannel('hisbenew/voice_frames');
  static const _askedKey = 'erp.micAsked';
  static Future<bool>? _request;

  static Future<bool> request() =>
      _request ??= _requestMicrophone().whenComplete(() => _request = null);

  static Future<bool> _requestMicrophone() async {
    if (await granted()) return true;
    try {
      return await _channel.invokeMethod<bool>('microphone') == true;
    } on PlatformException {
      return false;
    }
  }

  static Future<void> openSettings() async =>
      _channel.invokeMethod('openSettings');
  static Future<void> soundSettings() async =>
      _channel.invokeMethod('soundSettings');
  static Future<bool> testRingtone() async =>
      await _channel.invokeMethod<bool>('testRingtone') == true;
  static Future<void> startIncomingRing() async {
    try {
      await _channel.invokeMethod('startIncomingRing');
    } on PlatformException {
      return;
    }
  }

  static Future<void> stopIncomingRing() async {
    try {
      await _channel.invokeMethod('stopIncomingRing');
    } on PlatformException {
      return;
    } on MissingPluginException {
      return;
    }
  }

  static Future<void> startOutgoingRing() async {
    try {
      await _channel.invokeMethod('startOutgoingRing');
    } on PlatformException {
      return;
    }
  }

  static Future<void> stopOutgoingRing() async {
    try {
      await _channel.invokeMethod('stopOutgoingRing');
    } on PlatformException {
      return;
    }
  }

  /// Stops the ringtone without putting the speaker back to normal mode.
  static Future<void> releaseCallTone() async {
    try {
      await _channel.invokeMethod('releaseCallTone');
    } on PlatformException {
      return;
    } on MissingPluginException {
      return;
    }
  }

  static Future<void> notificationSettings() async =>
      _channel.invokeMethod('notificationSettings');
  static Future<void> startVoiceService() async =>
      _channel.invokeMethod('startVoiceService');
  static Future<void> stopVoiceService() async =>
      _channel.invokeMethod('stopVoiceService');
  static Future<bool> startVoiceRelay() async =>
      await _channel.invokeMethod<bool>('startVoiceRelay') == true;
  static Future<void> stopVoiceRelay() async {
    try {
      await _channel.invokeMethod('stopVoiceRelay');
    } on PlatformException {
      return;
    } on MissingPluginException {
      return;
    }
  }

  static Stream<Uint8List> voiceFrames() =>
      _voiceFramesChannel.receiveBroadcastStream().map((event) {
        if (event is Uint8List) return event;
        if (event is List<int>) return Uint8List.fromList(event);
        throw StateError('Invalid microphone frame');
      });
  static Future<void> playVoice(Uint8List frame) =>
      _channel.invokeMethod('playVoice', frame);
  static Future<void> setVoiceSpeaker(bool enabled) =>
      _channel.invokeMethod('setVoiceSpeaker', enabled);

  static Future<bool> granted() async {
    try {
      final allowed = await _channel.invokeMethod<bool>('microphoneStatus');
      return allowed == true;
    } on PlatformException {
      return false;
    }
  }

  /// Shows the system microphone prompt once. Later calls reuse that choice.
  static Future<void> askOnce() async {
    if (await granted()) return;
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getBool(_askedKey) == true) return;
    await prefs.setBool(_askedKey, true);
    try {
      await request();
    } on PlatformException {
      return;
    }
  }
}

class CallPermissionTile extends StatefulWidget {
  const CallPermissionTile({super.key});
  @override
  State<CallPermissionTile> createState() => _CallPermissionTileState();
}

class _CallPermissionTileState extends State<CallPermissionTile>
    with WidgetsBindingObserver {
  bool _allowed = false;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  Future<void> _refresh() async {
    final allowed = await PhonePermissions.granted();
    if (mounted) setState(() => _allowed = allowed);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(
    children: [
      ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Icon(_allowed ? Icons.mic : Icons.mic_off),
        title: const Text('Microphone for calls'),
        subtitle: Text(
          _allowed ? 'Enabled' : 'Allow microphone access to speak on calls',
        ),
        trailing: TextButton(
          onPressed: () async {
            if (_allowed || !await PhonePermissions.request()) {
              await PhonePermissions.openSettings();
            }
            await _refresh();
          },
          child: Text(_allowed ? 'Settings' : 'Enable'),
        ),
      ),
      ListTile(
        contentPadding: EdgeInsets.zero,
        leading: const Icon(Icons.notifications_active_outlined),
        title: const Text('Call and message alerts'),
        subtitle: const Text('Manage notification permissions'),
        trailing: const Icon(Icons.chevron_right),
        onTap: PhonePermissions.notificationSettings,
      ),
      ListTile(
        contentPadding: EdgeInsets.zero,
        leading: const Icon(Icons.volume_up_outlined),
        title: const Text('Incoming ringtone'),
        subtitle: const Text('Phone ringtone · uses your ringtone volume'),
        trailing: const Icon(Icons.chevron_right),
        onTap: PhonePermissions.soundSettings,
      ),
      Align(
        alignment: Alignment.centerLeft,
        child: TextButton.icon(
          icon: const Icon(Icons.play_circle_outline),
          label: const Text('Test ringtone'),
          onPressed: () async {
            final playing = await PhonePermissions.testRingtone();
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    playing
                        ? 'Playing a 4-second preview. If silent, check Do Not Disturb and phone sound settings.'
                        : 'Turn off silent/vibrate mode and increase ringtone volume in phone settings.',
                  ),
                ),
              );
            }
          },
        ),
      ),
    ],
  );
}
